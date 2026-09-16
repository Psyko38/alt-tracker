// Tests du serveur HTTP : pages statiques, routes API, exports, validation,
// protection contre la traversée de chemin. Données isolées et port libre.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { tmpDir, isolatedEnv, freePort, waitForHttp, pdfColumn, pdfTexts, ROOT } = require("./helpers");

const dir = tmpDir("jt-server");
let child;
let base;
let port;

/** Requête brute : `fetch` normalise les « ../ » dans l'URL, pas ce test */
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: rawPath, method: "GET" }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("serveur HTTP", () => {
  before(async () => {
    port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["server.js"], { env: isolatedEnv(dir, { PORT: String(port) }), cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    await waitForHttp(`${base}/api`);
  });
  after(async () => {
    child.kill();
    await new Promise((resolve) => child.on("exit", resolve));
  });

  test("la page et ses scripts sont servis", async () => {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type"), /text\/html/);
    const html = await index.text();
    assert.match(html, /Chart\.js|chart\.js/);
    const chart = await fetch(`${base}/chart.js`);
    assert.equal(chart.status, 200);
    assert.match(chart.headers.get("content-type"), /javascript/);
    const rules = await fetch(`${base}/rules.js`);
    assert.equal(rules.status, 200);
    assert.match(rules.headers.get("content-type"), /javascript/);
    assert.match(await rules.text(), /root\.Rules = factory\(\)/);
  });

  test("les fichiers statiques sont revalidés à chaque chargement", async () => {
    // Sans en-tête de cache, le navigateur applique sa propre péremption et peut servir
    // un style.css périmé après une modification : on débogue alors du CSS qui n'existe
    // plus. `no-cache` + ETag garantissent la version du disque (304 quand rien ne bouge).
    const css = await fetch(`${base}/style.css`);
    assert.equal(css.status, 200);
    assert.equal(css.headers.get("cache-control"), "no-cache");
    const etag = css.headers.get("etag");
    assert.ok(etag, "un ETag doit accompagner la réponse");

    const revalide = await fetch(`${base}/style.css`, { headers: { "If-None-Match": etag } });
    assert.equal(revalide.status, 304);
    assert.equal(await revalide.text(), "");

    // L'ETag change dès que le fichier change (taille ou date de modification).
    const autre = await fetch(`${base}/app.js`);
    assert.notEqual(autre.headers.get("etag"), etag);
  });

  test("les en-têtes de sécurité et HEAD sont corrects", async () => {
    const head = await fetch(`${base}/`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("x-content-type-options"), "nosniff");
    assert.equal(head.headers.get("referrer-policy"), "no-referrer");
  });
  test("le catalogue et les statistiques répondent", async () => {
    const catalogue = await (await fetch(`${base}/api`)).json();
    assert.ok(catalogue.endpoints.length >= 10);
    assert.deepEqual(catalogue.enums.statuses.length, 7);
    const stats = await (await fetch(`${base}/api/stats`)).json();
    assert.equal(stats.total, 0);
    const dashboard = await (await fetch(`${base}/api/dashboard`)).json();
    assert.equal(dashboard.stats.total, 0);
    assert.equal(dashboard.monthly.length, 12);
    assert.ok(Array.isArray(dashboard.byStatus));
  });

  test("le contrat d'API valide les paramètres, les méthodes et les enums d'import", async () => {
    const apiContract = require("../lib/api-contract");
    const catalogue = await (await fetch(`${base}/api`)).json();
    const openapi = await (await fetch(`${base}/api/openapi.json`)).json();
    const listQuery = catalogue.endpoints.find((endpoint) => endpoint.method === "GET" && endpoint.path === "/api/applications");
    assert.deepEqual(Object.keys(listQuery.query).sort(), Object.keys(apiContract.filterDescriptions()).sort());
    assert.deepEqual(openapi.paths["/api/applications"].get.parameters.map((parameter) => parameter.name).sort(), Object.keys(apiContract.filterDescriptions()).sort());

    const invalidFilter = await fetch(`${base}/api/applications?status=Peut-%C3%AAtre`);
    assert.equal(invalidFilter.status, 400);
    const invalidLimit = await fetch(`${base}/api/applications?limit=2abc`);
    assert.equal(invalidLimit.status, 400);
    const invalidImportMode = await fetch(`${base}/api/import?mode=overwrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ company: "Contrat", position: "Dev" }]),
    });
    assert.equal(invalidImportMode.status, 400);

    const app = await (await fetch(`${base}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Méthode", position: "Dev" }),
    })).json();
    const wrongMethod = await fetch(`${base}/api/applications/${app.id}/status`, { method: "GET" });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");
    await fetch(`${base}/api/applications/${app.id}`, { method: "DELETE" });
  });

  test("l'import refuse les statuts et types inconnus sans modifier la base", async () => {
    const before = await (await fetch(`${base}/api/applications`)).json();
    const invalid = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ company: "Invalide", position: "Dev", status: "Peut-être", type: "Contrat inconnu" }]),
    });
    assert.equal(invalid.status, 200);
    const summary = await invalid.json();
    assert.equal(summary.added, 0);
    assert.equal(summary.invalid.length, 1);
    assert.match(summary.invalid[0], /Statut invalide/);
    assert.equal((await (await fetch(`${base}/api/applications`)).json()).length, before.length);
  });

  test("les paramètres sort et limit renvoient le meilleur résultat trié", async () => {
    const created = [];
    for (const company of ["Zèbre", "Alpha contrat", "Médiane"]) {
      created.push(await (await fetch(`${base}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, position: "Dev" }),
      })).json());
    }
    const result = await (await fetch(`${base}/api/applications?sort=company&limit=1`)).json();
    assert.equal(result.length, 1);
    assert.equal(result[0].company, "Alpha contrat");
    for (const app of created) await fetch(`${base}/api/applications/${app.id}`, { method: "DELETE" });
  });
  test("créer, modifier puis supprimer une candidature", async () => {
    const cree = await fetch(`${base}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Villefontaine", position: "Alternance", contactEmail: "04 74 18 20 00" }),
    });
    assert.equal(cree.status, 201);
    const app = await cree.json();
    assert.equal(app.contactPhone, "04 74 18 20 00"); // numéro rangé automatiquement

    const change = await fetch(`${base}/api/applications/${app.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Entretien" }),
    });
    assert.equal((await change.json()).status, "Entretien");

    const invalide = await fetch(`${base}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "", position: "Dev" }),
    });
    assert.equal(invalide.status, 400);

    const supprime = await fetch(`${base}/api/applications/${app.id}`, { method: "DELETE" });
    assert.equal(supprime.status, 200);
    assert.equal((await (await fetch(`${base}/api/stats`)).json()).total, 0);
  });

  test("une écriture sur un id inconnu répond 404, avec le message de la lecture", async () => {
    const inconnu = "identifiant-inconnu";
    const json = { "Content-Type": "application/json" };

    for (const method of ["PUT", "PATCH"]) {
      const refus = await fetch(`${base}/api/applications/${inconnu}`, {
        method,
        headers: json,
        body: JSON.stringify({ status: "Postulé" }),
      });
      assert.equal(refus.status, 404, `${method} sur un id inconnu : le transport doit traduire « introuvable » en 404`);
      assert.equal((await refus.json()).error, "Candidature introuvable");
    }

    const statut = await fetch(`${base}/api/applications/${inconnu}/status`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ status: "Postulé" }),
    });
    assert.equal(statut.status, 404);

    // Un id inconnu est refusé AVANT l'instantané de sécurité : une suppression qui
    // n'aura pas lieu ne doit pas remplir data/backups/.
    const avant = (await (await fetch(`${base}/api/backups`)).json()).files.length;
    const supprime = await fetch(`${base}/api/applications/${inconnu}`, { method: "DELETE" });
    assert.equal(supprime.status, 404);
    assert.equal((await supprime.json()).error, "Candidature introuvable");
    assert.equal((await (await fetch(`${base}/api/backups`)).json()).files.length, avant);

    // Contrôle négatif : la même écriture sur une fiche existante réussit — sans
    // quoi ce test passerait aussi avec un serveur qui refuse tout.
    const cible = await (await fetch(`${base}/api/applications`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ company: "Cible", position: "Dev" }),
    })).json();
    const modifie = await fetch(`${base}/api/applications/${cible.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ status: "Postulé" }),
    });
    assert.equal(modifie.status, 200);
    assert.equal((await modifie.json()).status, "Postulé");
    await fetch(`${base}/api/applications/${cible.id}`, { method: "DELETE" });
  });

  test("les trois exports répondent avec le bon format", async () => {
    await fetch(`${base}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "EEMI Lyon", position: "Alternance" }),
    });
    await fetch(`${base}/api/cover`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, title: "TP DEVELOPPEUR WEB" }),
    });

    const json = await (await fetch(`${base}/api/export`)).json();
    assert.equal(json.exportVersion, 2);
    assert.equal(json.count, 1);
    assert.equal(json.cover.title, "TP DEVELOPPEUR WEB");

    const csv = await fetch(`${base}/api/export/csv`);
    assert.match(csv.headers.get("content-type"), /text\/csv/);
    assert.match(csv.headers.get("content-disposition"), /candidatures-\d{4}-\d{2}-\d{2}\.csv/);
    assert.equal((await csv.arrayBuffer()).byteLength > 100, true);

    const pdf = await fetch(`${base}/api/export/pdf`);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    const octets = Buffer.from(await pdf.arrayBuffer());
    assert.equal(octets.slice(0, 5).toString(), "%PDF-");
  });

  test("le PDF met le téléphone sous TÉLÉPHONE, jamais dans la colonne EMAIL", async () => {
    // Cas vu en vrai : le numéro avait été saisi dans le champ e-mail. Le PDF ne doit
    // pas se contenter de l'afficher quelque part — il doit le ranger dans la bonne
    // colonne, et laisser l'adresse seule dans EMAIL.
    const cree = await (await fetch(`${base}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: "BJ - Recrutement",
        position: "Alternance",
        contactEmail: "04.74.93.00.54 - recrutement@bourgoinjallieu.fr",
      }),
    })).json();

    const pdf = Buffer.from(await (await fetch(`${base}/api/export/pdf`)).arrayBuffer());
    const tel = pdfColumn(pdf, "TÉLÉPHONE");
    const mail = pdfColumn(pdf, "EMAIL");
    assert.ok(tel && mail, "les colonnes TÉLÉPHONE et EMAIL doivent exister dans le PDF");
    assert.ok(tel.includes("04.74.93.00.54"), `numéro absent de la colonne TÉLÉPHONE : ${tel.join(" | ")}`);
    assert.ok(mail.includes("recrutement@bourgoinjallieu.fr"), `e-mail absent de la colonne EMAIL : ${mail.join(" | ")}`);
    assert.ok(!mail.some((t) => /\d{2}[.\s]?\d{2}/.test(t)), `aucun numéro ne doit rester dans EMAIL : ${mail.join(" | ")}`);

    await fetch(`${base}/api/applications/${cree.id}`, { method: "DELETE" });
  });

  test("les exports CSV et PDF suivent la sélection, pas tout le suivi", async () => {
    const crees = [];
    for (const [company, status] of [["Filtre A", "Postulé"], ["Filtre B", "Refus"], ["Filtre C", "Postulé"]]) {
      const res = await fetch(`${base}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, position: "Développeur", status }),
      });
      crees.push(await res.json());
    }
    const total = (await (await fetch(`${base}/api/applications`)).json()).length;
    const postule = encodeURIComponent("Postulé");

    // CSV : seules les lignes de la sélection
    const csvRes = await fetch(`${base}/api/export/csv?status=${postule}`);
    assert.match(csvRes.headers.get("content-disposition"), /candidatures-\d{4}-\d{2}-\d{2}-postule\.csv/);
    const csv = (await csvRes.text()).replace(/^\uFEFF/, "").trim();
    const lignes = csv.split("\r\n");
    assert.equal(lignes.length, 3, `en-tête + 2 lignes « Postulé » attendues, vu ${lignes.length}`);
    assert.ok(csv.includes("Filtre A") && csv.includes("Filtre C"), "les fiches « Postulé » doivent être là");
    assert.ok(!csv.includes("Filtre B"), "la fiche « Refus » ne doit pas être exportée");

    // PDF : l'en-tête annonce la sélection et le nom du fichier la rappelle
    const pdfRes = await fetch(`${base}/api/export/pdf?status=${postule}`);
    assert.match(pdfRes.headers.get("content-disposition"), /-postule\.pdf/);
    const texts = pdfTexts(Buffer.from(await pdfRes.arrayBuffer()));
    const entete = texts.find((t) => t.includes("Jobs, alternance"));
    assert.ok(entete, "l'en-tête du PDF est introuvable");
    assert.match(entete, /2 candidatures/);
    assert.ok(entete.includes(`sur ${total}`), `l'en-tête doit situer la sélection : ${entete}`);
    assert.ok(entete.includes("Postulé"), `le filtre doit être rappelé : ${entete}`);

    // Plage de dates (bornes incluses) : les fiches créées aujourd'hui sont dedans
    const today = new Date().toISOString().slice(0, 10);
    const jour = today.split("-").reverse().join("/");
    const resPlage = await fetch(`${base}/api/export/csv?from=${today}&to=${today}`);
    assert.match(resPlage.headers.get("content-disposition"), /-le-\d{2}-\d{2}-\d{4}\.csv/);
    const lignesPlage = (await resPlage.text()).replace(/^\uFEFF/, "").trim().split("\r\n");
    assert.equal(lignesPlage.length - 1, total, "toutes les fiches du jour doivent sortir");

    const horsPlage = await fetch(`${base}/api/export/csv?from=2000-01-01&to=2000-01-31`);
    const lignesHors = (await horsPlage.text()).replace(/^\uFEFF/, "").trim().split("\r\n");
    assert.equal(lignesHors.length, 1, "hors plage : en-tête seul");

    // Le PDF rappelle aussi la plage dans son en-tête
    const pdfPlage = Buffer.from(await (await fetch(`${base}/api/export/pdf?from=${today}&to=${today}`)).arrayBuffer());
    const entetePlage = pdfTexts(pdfPlage).find((t) => t.includes("Jobs, alternance"));
    assert.ok(entetePlage.includes(`le ${jour}`), `plage absente de l'en-tête : ${entetePlage}`);

    // La sauvegarde JSON, elle, reste complète : c'est le filet de sécurité
    assert.equal((await (await fetch(`${base}/api/export`)).json()).count, total);

    for (const cree of crees) await fetch(`${base}/api/applications/${cree.id}`, { method: "DELETE" });
  });

  test("l'import restaure la page de garde et refuse un corps vide", async () => {
    const sauvegarde = await (await fetch(`${base}/api/export`)).json();
    await fetch(`${base}/api/cover`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Titre écrasé", enabled: false }),
    });
    const resume = await fetch(`${base}/api/import?mode=merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sauvegarde),
    });
    assert.equal(resume.status, 200);
    const corps = await resume.json();
    assert.equal(corps.cover, true);
    assert.equal(corps.skipped, 1);
    assert.equal((await (await fetch(`${base}/api/cover`)).json()).title, "TP DEVELOPPEUR WEB");

    const vide = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    });
    assert.equal(vide.status, 400);
  });

  test("les instantanés de la base se listent, se créent et se restaurent", async () => {
    // Un état de départ connu, puis un instantané de ce moment-là
    const avant = await (await fetch(`${base}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Avant restauration", position: "Dev" }),
    })).json();
    const cree = await (await fetch(`${base}/api/backups`, { method: "POST" })).json();
    assert.match(cree.created, /^applications-\d{8}-\d{6}-\d{3}\.sqlite$/);

    const liste = await (await fetch(`${base}/api/backups`)).json();
    assert.equal(liste.keep, 10);
    assert.ok(liste.files.some((file) => file.name === cree.created && file.bytes > 0), "l'instantané créé doit être listé");
    // Le listing annonce ce que contient chaque instantané : on choisit en connaissance de cause
    assert.ok(liste.files.every((file) => Number.isInteger(file.applications)), "chaque instantané annonce son nombre de fiches");

    // On écrit après coup, puis on restaure : la fiche tardive doit disparaître
    const apres = await (await fetch(`${base}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Ajoutée après", position: "Dev" }),
    })).json();
    const restaure = await (await fetch(`${base}/api/backups/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cree.created }),
    })).json();
    assert.equal(restaure.restored, cree.created);
    assert.ok(restaure.safety, "l'état écrasé est copié avant la restauration");

    const apresRestauration = await (await fetch(`${base}/api/applications`)).json();
    assert.ok(apresRestauration.some((app) => app.id === avant.id), "la fiche d'avant doit être revenue");
    assert.ok(!apresRestauration.some((app) => app.id === apres.id), "la fiche d'après doit avoir disparu");

    // Nom inconnu (ou tentative de traversée) : refusé, sans toucher aux données
    for (const body of [{ name: "../../applications.sqlite" }, { name: "inconnu.sqlite" }, {}]) {
      const refus = await fetch(`${base}/api/backups/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(refus.status, body.name ? 404 : 400);
    }
    assert.equal((await (await fetch(`${base}/api/applications`)).json()).length, apresRestauration.length);

    // La restauration est elle-même réversible : on revient sur l'instant de sécurité
    const retour = await (await fetch(`${base}/api/backups/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: restaure.safety }),
    })).json();
    assert.equal(retour.total, apresRestauration.length + 1);
  });

  test("sans sauvegarde possible, l'API l'explique et ne détruit rien", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
    const fiche = await (await fetch(`${base}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Protégée", position: "Dev" }),
    })).json();

    const backups = path.join(dir, "backups");
    fs.mkdirSync(backups, { recursive: true });
    fs.chmodSync(backups, 0o555);
    try {
      const refus = await fetch(`${base}/api/applications/${fiche.id}`, { method: "DELETE" });
      assert.equal(refus.status, 500);
      // Le message doit dire quoi faire, pas « Erreur interne du serveur »
      assert.match((await refus.json()).error, /Sauvegarde de sécurité impossible/);
      const restants = await (await fetch(`${base}/api/applications`)).json();
      assert.ok(restants.some((app) => app.id === fiche.id), "la fiche reste : rien ne disparaît sans filet");
    } finally {
      fs.chmodSync(backups, 0o755);
    }

    // Droits rendus : la suppression redevient possible, et on nettoie derrière nous
    assert.deepEqual(await (await fetch(`${base}/api/applications/${fiche.id}`, { method: "DELETE" })).json(), { ok: true });
  });

  test("une route statique refuse les méthodes d'écriture", async () => {
    const res = await fetch(`${base}/`, { method: "POST", body: "x" });
    assert.equal(res.status, 405);
    assert.match(res.headers.get("allow"), /GET/);
  });
  test("404 route inconnue, 405 méthode non autorisée avec l'en-tête Allow", async () => {
    assert.equal((await fetch(`${base}/api/inconnu`)).status, 404);
    const mauvais = await fetch(`${base}/api/stats`, { method: "DELETE" });
    assert.equal(mauvais.status, 405);
    assert.match(mauvais.headers.get("allow"), /GET/);
  });

  test("la traversée de chemin est bloquée", async () => {
    assert.equal(await rawGet("/..%2Fpackage.json"), 403);
    assert.equal(await rawGet("/..%2F..%2Fetc%2Fpasswd"), 403);
    // et un fichier inexistant reste un 404
    assert.equal(await rawGet("/pas-la.html"), 404);
  });

  test("les données du serveur de test restent isolées", () => {
    assert.ok(fs.existsSync(path.join(dir, "applications.sqlite")));
  });
});
