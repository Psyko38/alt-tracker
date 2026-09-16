// Tests du serveur MCP, piloté en stdio comme le ferait un client (Claude Desktop,
// Cursor…). Données isolées : le vrai data/ n'est jamais touché.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { tmpDir, isolatedEnv, mcpClient } = require("./helpers");

const dir = tmpDir("jt-mcp");
let mcp;

describe("serveur MCP", () => {
  before(() => {
    mcp = mcpClient(isolatedEnv(dir));
  });
  after(async () => {
    await mcp.close();
  });

  test("initialize annonce le nom et la version du paquet", async () => {
    const res = await mcp.call("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
    assert.equal(res.result.serverInfo.name, "job-tracker");
    assert.equal(res.result.serverInfo.version, require("../package.json").version);
  });

  test("tools/list expose les 18 outils attendus", async () => {
    const res = await mcp.call("tools/list", {});
    const noms = res.result.tools.map((t) => t.name);
    assert.deepEqual(noms, [
      "get_schema",
      "list_applications",
      "get_application",
      "create_application",
      "update_application",
      "set_status",
      "delete_application",
      "get_stats",
      "get_cover",
      "set_cover",
      "export_applications",
      "export_csv",
      "export_pdf",
      "import_applications",
      "list_backups",
      "create_backup",
      "restore_backup",
      "get_followups",
    ]);
    for (const outil of res.result.tools) {
      assert.ok(outil.description && outil.description.length > 20, `description manquante : ${outil.name}`);
      assert.equal(outil.inputSchema.type, "object");
    }
  });

  test("chaque outil exposé est appelé par au moins un test", async () => {
    const res = await mcp.call("tools/list", {});
    // Les tests appellent les outils via mcp.tool("nom", …) : on relit donc les
    // sources de test pour vérifier qu'aucun outil annoncé n'est laissé de côté.
    // Un appel mis en commentaire ne compte pas.
    const sources = fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith(".test.js"))
      .map((f) => fs.readFileSync(path.join(__dirname, f), "utf8").replace(/^\s*\/\/.*$/gm, ""))
      .join("\n");
    const jamaisAppeles = res.result.tools
      .map((t) => t.name)
      .filter((name) => !new RegExp(`\\.tool\\(\\s*["']${name}["']`).test(sources));
    assert.deepEqual(jamaisAppeles, [], `outil(s) MCP jamais appelé(s) par un test : ${jamaisAppeles.join(", ")}`);
  });

  test("get_schema décrit les champs, les enums, les conventions, les analyses et les sauvegardes", async () => {
    const schema = await mcp.tool("get_schema", {});
    assert.equal(schema.fields.length, require("../lib/fields").FIELD_DEFS.length);
    assert.deepEqual(schema.statuses, require("../lib/rules").STATUSES);
    assert.equal(schema.followUp.delaysByStatus.Postulé, 14);
    assert.ok(schema.conventions.exports.includes("export_pdf"));
    // Un agent qui n'a que cet outil sait où sont les analyses et les instantanés
    assert.ok(schema.insights.funnel.includes("envoyées"));
    assert.ok(schema.backups.when.includes("démarrage"));
  });

  test("create_application range le téléphone saisi dans l'e-mail", async () => {
    const app = await mcp.tool("create_application", {
      company: "Test MCP",
      position: "Développeur",
      contactEmail: "04 72 20 77 04 - contact@test.fr",
    });
    assert.equal(app.contactPhone, "04 72 20 77 04");
    assert.equal(app.contactEmail, "contact@test.fr");
    assert.equal(app.status, "À postuler");
  });

  test("set_status change le statut et refuse une valeur inconnue", async () => {
    const apps = await mcp.tool("list_applications", {});
    const id = apps[0].id;
    assert.equal((await mcp.tool("set_status", { id, status: "Entretien" })).status, "Entretien");
    const erreur = await mcp.tool("set_status", { id, status: "Peut-être" });
    assert.match(erreur.error, /Statut invalide/);
    assert.match(erreur.error, /Valeurs possibles/);
  });

  test("les données restent dans le dossier isolé : les exports écrivent un fichier", async () => {
    const json = await mcp.tool("export_applications", { path: path.join(dir, "sauvegarde.json") });
    assert.equal(json.path, path.join(dir, "sauvegarde.json"));
    const payload = JSON.parse(fs.readFileSync(json.path, "utf8"));
    assert.equal(payload.exportVersion, 2);
    assert.ok(Array.isArray(payload.applications));
    assert.ok(payload.cover, "la sauvegarde doit embarquer la page de garde");

    const csv = await mcp.tool("export_csv", { path: path.join(dir, "tableau.csv") });
    assert.equal(fs.readFileSync(csv.path)[0], 0xef); // BOM UTF-8
    assert.match(fs.readFileSync(csv.path, "utf8"), /"Téléphone"/);

    const pdf = await mcp.tool("export_pdf", { path: path.join(dir, "sous-dossier", "tableau.pdf") });
    assert.equal(fs.readFileSync(pdf.path).slice(0, 5).toString(), "%PDF-");
    assert.ok(pdf.bytes > 1000);
  });

  test("export_csv / export_pdf acceptent une sélection", async () => {
    await mcp.tool("create_application", { company: "Sélection", position: "Dev", status: "Postulé" });
    await mcp.tool("create_application", { company: "Hors sélection", position: "Dev", status: "Refus" });
    const total = (await mcp.tool("list_applications", {})).length;

    const csv = await mcp.tool("export_csv", { status: "Postulé" });
    assert.equal(csv.count, 1);
    assert.equal(csv.total, total);
    assert.equal(csv.selection, "Postulé");
    // Le nom de fichier par défaut rappelle le filtre : deux exports du même jour
    // ne s'écrasent plus dans le dossier de téléchargement.
    assert.match(path.basename(csv.path), /-postule\.csv$/);
    const contenu = fs.readFileSync(csv.path, "utf8");
    assert.ok(contenu.includes("Sélection") && !contenu.includes("Hors sélection"));

    const pdf = await mcp.tool("export_pdf", { quick: "refused" });
    assert.equal(pdf.count, 1);
    assert.equal(pdf.selection, "refusées");
    assert.match(path.basename(pdf.path), /-refusees\.pdf$/);

    // Sans filtre, on exporte tout (comportement d'origine)
    const tout = await mcp.tool("export_csv", { path: path.join(dir, "tout.csv") });
    assert.equal(tout.count, total);
    assert.equal(tout.selection, undefined);

    // Plage de dates : bornes incluses, et les fiches sans date sortent de la sélection
    const today = new Date().toISOString().slice(0, 10);
    const jour = await mcp.tool("list_applications", { from: today, to: today });
    assert.equal(jour.length, total);
    assert.match(path.basename((await mcp.tool("export_csv", { from: today, to: today })).path), /-le-\d{2}-\d{2}-\d{4}\.csv$/);
    assert.deepEqual(await mcp.tool("list_applications", { from: "2000-01-01", to: "2000-01-31" }), []);
    assert.deepEqual(await mcp.tool("list_applications", { from: "pas-une-date" }).then((l) => l.length), total);
  });

  test("import : doublons ignorés, fichier accepté, données manquantes refusées", async () => {
    const apps = await mcp.tool("list_applications", {});
    const doublon = await mcp.tool("import_applications", { data: apps });
    assert.equal(doublon.added, 0);
    assert.equal(doublon.skipped, apps.length);

    const nouvelle = await mcp.tool("import_applications", { data: [{ company: "Nouvelle", position: "Dev" }] });
    assert.equal(nouvelle.added, 1);

    const depuisFichier = await mcp.tool("import_applications", { path: path.join(dir, "sauvegarde.json") });
    assert.ok(depuisFichier.skipped >= 1);

    const erreur = await mcp.tool("import_applications", {});
    assert.match(erreur.error, /Fournir `data`/);
  });

  test("la page de garde fait l'aller-retour export → import", async () => {
    await mcp.tool("set_cover", { enabled: true, title: "TP DEVELOPPEUR WEB", text: "Objectif" });
    const out = await mcp.tool("export_applications", { path: path.join(dir, "garde.json") });
    assert.equal(out.cover.title, "TP DEVELOPPEUR WEB");
    await mcp.tool("set_cover", { enabled: false, title: "Titre bidon" });
    const resume = await mcp.tool("import_applications", { path: out.path, mode: "replace" });
    assert.equal(resume.cover, true);
    assert.ok(resume.backup, "un remplacement doit sauvegarder les données écrasées");
    assert.equal((await mcp.tool("get_cover", {})).title, "TP DEVELOPPEUR WEB");
  });

  test("delete_application et get_followups répondent", async () => {
    const apps = await mcp.tool("list_applications", {});
    assert.deepEqual(await mcp.tool("delete_application", { id: apps[0].id }), { ok: true });
    const erreur = await mcp.tool("delete_application", { id: apps[0].id });
    assert.match(erreur.error, /introuvable/i);
    const restants = await mcp.tool("list_applications", {});
    assert.equal(restants.length, apps.length - 1);
    assert.ok(Array.isArray(await mcp.tool("get_followups", {})));
    assert.equal((await mcp.tool("get_stats", {})).total, restants.length);
  });

  test("les outils de sauvegarde listent, créent et restaurent un instantané", async () => {
    // Un agent doit pouvoir revenir en arrière lui aussi : mêmes instantanés que l'interface
    assert.ok(Array.isArray((await mcp.tool("list_backups", {})).files));

    const cree = await mcp.tool("create_backup", {});
    assert.match(cree.created, /^applications-\d{8}-\d{6}-\d{3}\.sqlite$/);
    assert.ok(cree.files.some((file) => file.name === cree.created && typeof file.applications === "number"));

    const avant = (await mcp.tool("list_applications", {})).length;
    await mcp.tool("create_application", { company: "Après l'instantané", position: "Dev" });

    const restaure = await mcp.tool("restore_backup", { name: cree.created });
    assert.equal(restaure.restored, cree.created);
    assert.equal(restaure.total, avant);
    assert.ok(restaure.safety, "l'état écrasé est copié avant la restauration");

    const inconnu = await mcp.tool("restore_backup", { name: "inconnu.sqlite" });
    assert.match(inconnu.error, /introuvable/i);
  });

  test("get_application relit une fiche par son id et signale un id inconnu", async () => {
    const cree = await mcp.tool("create_application", {
      company: "Fiche MCP",
      position: "Data analyst",
      location: "Lyon",
      postalCode: "69002",
    });
    const relu = await mcp.tool("get_application", { id: cree.id });
    assert.equal(relu.id, cree.id);
    assert.equal(relu.company, "Fiche MCP");
    assert.equal(relu.position, "Data analyst");
    assert.equal(relu.location, "Lyon");
    assert.equal(relu.postalCode, "69002");
    assert.equal(relu.status, "À postuler");
    // L'erreur est un résultat lisible, pas une rupture du protocole
    const absent = await mcp.tool("get_application", { id: "identifiant-inconnu" });
    assert.match(absent.error, /introuvable/i);
    assert.match(absent.error, /identifiant-inconnu/);
  });

  test("update_application ne touche qu'aux champs fournis et refuse une valeur invalide", async () => {
    const cree = await mcp.tool("create_application", {
      company: "Patch MCP",
      position: "Développeur",
      location: "Lyon",
      notes: "à conserver",
    });
    const maj = await mcp.tool("update_application", { id: cree.id, location: "Villeurbanne", postalCode: "69100" });
    assert.equal(maj.location, "Villeurbanne");
    assert.equal(maj.postalCode, "69100");
    // Les champs absents du patch gardent leur valeur
    assert.equal(maj.company, "Patch MCP");
    assert.equal(maj.position, "Développeur");
    assert.equal(maj.notes, "à conserver");
    assert.equal(maj.status, "À postuler");
    assert.equal(maj.id, cree.id);

    // Valeur refusée : la fiche reste intacte
    const vide = await mcp.tool("update_application", { id: cree.id, company: "   " });
    assert.match(vide.error, /entreprise|company/i);
    const absent = await mcp.tool("update_application", { id: "identifiant-inconnu", location: "Lyon" });
    assert.match(absent.error, /introuvable/i);
    const relu = await mcp.tool("get_application", { id: cree.id });
    assert.equal(relu.company, "Patch MCP");
    assert.equal(relu.location, "Villeurbanne");
  });
});
