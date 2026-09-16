// Tests des exports partagés (CSV, sauvegarde JSON, écriture des fichiers).
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { tmpDir, isolatedEnv, ROOT } = require("./helpers");

const dir = tmpDir("jt-export");
const env = isolatedEnv(dir);
process.env.JOB_TRACKER_DB_FILE = env.JOB_TRACKER_DB_FILE;

const exports_ = require("../lib/export");
const { importApplications } = require("../lib/import");

/**
 * Tout le JavaScript que la page sert : le point d'entrée, les modules sous
 * `public/js/`, et `public/index.html` pour son script en ligne. C'est la surface
 * qu'il faut balayer quand on veut vérifier qu'une règle n'y est pas recopiée —
 * `public/app.js` seul ne dit plus rien, il ne porte que l'assemblage.
 */
function frontEndFiles() {
  const jsDir = path.join(ROOT, "public", "js");
  const modules = fs
    .readdirSync(jsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(jsDir, name))
    .sort();
  return [path.join(ROOT, "public", "app.js"), ...modules, path.join(ROOT, "public", "index.html")];
}

/**
 * Tout le JavaScript du serveur : les modules de `lib/`. Ils sont plusieurs
 * depuis que la couche de données est découpée (base, modèle, instantanés,
 * import, stats…) : ne lire que `store.js` n'y prouverait plus rien.
 */
function dataLayerFiles() {
  const libDir = path.join(ROOT, "lib");
  return fs
    .readdirSync(libDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(libDir, name))
    .sort();
}

const app = {
  company: 'Entreprise "guillemets"',
  position: "Dev",
  status: "Postulé",
  type: "Alternance",
  dateDemarche: "2026-09-12",
  postalCode: "69002",
  location: "Lyon",
  source: "HelloWork",
  contactName: "Marie Dupond",
  contactEmail: "recrutement@exemple.fr",
  contactPhone: "04 72 20 77 04",
  nextAction: "2026-09-20",
  notes: "ligne 1\nligne 2",
};

describe("CSV", () => {
  test("format Excel FR : BOM, séparateur « ; », en-têtes de l'interface", () => {
    const buf = exports_.applicationsCsv([app]);
    assert.equal(buf[0], 0xef);
    assert.equal(buf[1], 0xbb);
    assert.equal(buf[2], 0xbf);
    const [header, ligne] = buf.toString("utf8").slice(1).split("\r\n");
    assert.equal(header, '"Entreprise";"Poste";"Statut";"Type";"Date démarche";"Code postal";"Lieu";"Source";"Contact";"Email";"Téléphone";"Prochaine action";"Notes"');
    assert.match(ligne, /"Entreprise ""guillemets"""/);
    assert.match(ligne, /"12\/09\/2026"/);
    assert.match(ligne, /"04 72 20 77 04"/);
    assert.match(ligne, /"20\/09\/2026"/); // prochaine action au format FR, comme la démarche
  });

  test("une adresse vide ou absente ne casse pas la ligne", () => {
    const buf = exports_.applicationsCsv([{ company: "X", position: "Dev" }]);
    const ligne = buf.toString("utf8").split("\r\n")[1];
    assert.equal(ligne.split(";").length, 13);
  });
});

describe("sauvegarde JSON", () => {
  test("elle embarque la page de garde et reste réimportable", () => {
    const cover = { enabled: true, title: "TP", subtitle: "", text: "", showStats: true };
    const payload = exports_.backupPayload([app], { cover });
    assert.equal(payload.exportVersion, 2);
    assert.equal(payload.count, 1);
    assert.deepEqual(payload.cover, cover);
    assert.equal(payload.applications[0].company, app.company);
    // Ce que l'app sait réimporter
    assert.ok(Array.isArray(payload.applications));
  });

  test("sans page de garde, la clé est absente (compatibilité ascendante)", () => {
    const payload = exports_.backupPayload([app]);
    assert.equal("cover" in payload, false);
    assert.equal(payload.exportVersion, 2);
  });
});

describe("fichiers d'export", () => {
  test("le chemin par défaut est daté, sous data/exports", () => {
    const p = exports_.defaultExportPath("pdf");
    assert.equal(path.dirname(p), path.join(path.dirname(env.JOB_TRACKER_DB_FILE), "exports"));
    assert.match(path.basename(p), /^candidatures-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  test("l'écriture crée les dossiers manquants et renvoie le chemin", () => {
    const cible = path.join(dir, "sous", "dossier", "export.csv");
    const res = exports_.writeExportFile(cible, exports_.applicationsCsv([app]));
    assert.equal(res.path, path.resolve(cible));
    assert.equal(res.bytes, fs.statSync(cible).size);
    assert.match(fs.readFileSync(cible, "utf8"), /Entreprise/);
  });

  test("exportList applique les migrations (numéro rangé dans le téléphone)", () => {
    importApplications([{ id: "1", company: "X", position: "Dev", contactEmail: "04 72 20 77 04" }], { mode: "replace" });
    const [exporte] = exports_.exportList();
    assert.equal(exporte.contactPhone, "04 72 20 77 04");
    assert.equal(exporte.contactEmail, "");
  });

  test("le module est partagé : le serveur HTTP et le serveur MCP importent le même fichier", () => {
    const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
    const mcp = fs.readFileSync(path.join(ROOT, "mcp-server.js"), "utf8");
    assert.match(server, /require\("\.\/lib\/export"\)/);
    assert.match(mcp, /require\("\.\/lib\/export"\)/);
  });
});

describe("règles partagées", () => {
  test("le module dual fonctionne côté serveur et côté navigateur", () => {
    const fs2 = require("node:fs");
    const source = fs2.readFileSync(path.join(ROOT, "lib", "rules.js"), "utf8");
    // Le même fichier doit savoir s'exporter en module CommonJS… 
    assert.match(source, /module\.exports = factory\(\)/);
    // …et s'exposer comme variable globale quand il est chargé en <script>
    assert.match(source, /root\.Rules = factory\(\)/);
    const indexHtml = fs2.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
    assert.ok(indexHtml.indexOf("/rules.js") < indexHtml.indexOf("/app.js"), "rules.js doit être chargé avant app.js");
  });

  // Une définition, quelle que soit sa forme : `const|let|var|function|class`,
  // éventuellement précédée d'`export`. Volontairement pas de correspondance sur
  // `const { followUpState } = Rules` (une lecture déstructurée, pas une copie).
  const REDEFINITION = /(?:^|[^\w.$])(?:export\s+)?(?:const|let|var|function|class)\s+(FOLLOWUP_DELAYS|followUpState)\b/;

  test("la couche de données et l'interface ne redéfinissent plus les règles de relance", () => {
    const rulesSource = fs.readFileSync(path.join(ROOT, "lib", "rules.js"), "utf8");

    // La règle a une seule maison, et elle y est vraiment définie : sans cette
    // assertion, supprimer la règle partout ferait passer le test.
    assert.match(rulesSource, REDEFINITION, "lib/rules.js doit définir les délais de relance et followUpState");

    // …et aucune autre module du serveur ne la recopie. La couche de données est
    // découpée : c'est l'ensemble de `lib/` qu'il faut balayer, pas `store.js` seul.
    for (const file of dataLayerFiles()) {
      if (path.basename(file) === "rules.js") continue;
      const relative = path.relative(ROOT, file);
      assert.doesNotMatch(
        fs.readFileSync(file, "utf8"),
        REDEFINITION,
        `${relative} redéfinit FOLLOWUP_DELAYS ou followUpState : la règle ne vit que dans lib/rules.js`
      );
    }

    // …et nulle part ailleurs dans ce que la page sert. L'interface ne vit plus
    // dans public/app.js (100 lignes d'assemblage) mais dans ses modules : ce sont
    // eux qu'il faut balayer, sinon une copie peut apparaître sans que rien ne
    // bronche. index.html est inclus pour son script en ligne.
    for (const file of frontEndFiles()) {
      const relative = path.relative(ROOT, file);
      assert.doesNotMatch(
        fs.readFileSync(file, "utf8"),
        REDEFINITION,
        `${relative} redéfinit FOLLOWUP_DELAYS ou followUpState : la règle ne vit que dans lib/rules.js`
      );
    }

    // L'interface s'en sert pour de bon : un balayage vide serait vrai pour la
    // mauvaise raison (un écran qui aurait cessé de connaître la notion).
    const consommateurs = frontEndFiles().filter((file) => /\bfollowUpState\b|\bFOLLOWUP_DELAYS\b/.test(fs.readFileSync(file, "utf8")));
    assert.ok(
      consommateurs.length > 0,
      "un module de l'interface doit lire la règle de relance depuis Rules"
    );
  });
});
