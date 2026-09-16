// Garde-fou de structure de la couche serveur (`lib/`), comme
// test/public-modules.test.js l'est pour la page.
//
// Trois choses sont verrouillées ici, parce qu'une refonte les avait rendues
// implicites : les dépendances entre modules ne remontent jamais d'une couche
// basse vers une couche haute (et ne forment aucun cycle), les règles métier
// n'ont qu'une porte — `require("./rules")` — et le code HTTP ne vit que dans le
// transport, pas dans la couche de données.
//
// Ce que ces contrôles atteignent, et ce qu'ils n'atteignent pas :
//   * le contrôle de porte lit la SOURCE (un `require("./rules")` est exigé dès
//     qu'une règle est nommée) : il ne voit donc pas un accès calculé
//     (`membres[i]`, `s["STAT" + "USES"]`). C'est une limite assumée, pas une
//     porte ouverte : un accès calculé ne peut lire que `require("./rules")`,
//     puisqu'aucun autre module n'expose les règles — et les deux façons d'en
//     faire une seconde porte (réexportation, recopie) sont vues ci-dessous.
//     Voir l'accès lui-même demanderait d'instrumenter le `require` (un Proxy
//     sur le module des règles) : disproportionné pour ce qu'il protégerait ;
//   * le contrôle de réexport lit les VALEURS réellement exportées : une clé qui
//     EST la règle (par référence) ou qui en RECOPIE la valeur (même tableau,
//     même objet, même scalaire membre sous un autre nom) fait échouer le test,
//     quelle que soit la mise en forme du `module.exports`. Seul un ÉLÉMENT de
//     règle recopié seul (`"Postulé"`, une valeur de `STATUSES`) reste hors de
//     portée — une chaîne ne dit pas d'où elle vient, et le chercher dans tout le
//     texte ferait crier le test sur chaque libellé qui ressemble à un statut ;
//   * le contrôle de couches lit les `require("./…")` littéraux qui résolvent
//     dans `lib/` : une flèche qui sort de `lib/` (`require("../server.js")`) ou
//     un fichier mal orthographié ne compte pas comme une arête.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ROOT } = require("./helpers");

const LIB_DIR = path.join(ROOT, "lib");

/**
 * La couche d'un module. Une flèche ne va que vers un module de couche inférieure
 * ou égale : c'est ce qui rend l'ordre des dépendances lisible, et ce qui empêche
 * un module bas de se mettre à connaître un écran.
 *
 * Toute nouvelle couche doit être déclarée ici : le test nomme alors le module
 * oublié au lieu de le laisser passer.
 */
const LAYERS = {
  // 0 — feuilles : aucune dépendance interne (ou uniquement entre elles)
  "rules.js": 0,
  "files.js": 0,
  "errors.js": 0,
  "fields.js": 0,
  // 1 — modèle de données et transformations
  "model.js": 1,
  "snapshots.js": 1,
  "api-contract.js": 1,
  // 2 — la base
  "sqlite.js": 2,
  // 3 — services de la base
  "backups.js": 3,
  "cover.js": 3,
  "stats.js": 3,
  // 4 — opérations métier
  "store.js": 4,
  "import.js": 4,
  // 5 — sorties
  "pdf.js": 5,
  "export.js": 5,
};

function libFiles() {
  return fs.readdirSync(LIB_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort();
}

/**
 * Le code sans ses commentaires : un exemple de `require` cité dans une
 * explication ne doit pas compter comme une dépendance, et une règle nommée en
 * prose ne doit pas passer pour un usage.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function read(name) {
  return fs.readFileSync(path.join(LIB_DIR, name), "utf8");
}

/** Le code du module, commentaires retirés */
function code(name) {
  return stripComments(read(name));
}

/**
 * La forme sérialisable d'une valeur : ce qui permet de reconnaître une RECOPIE
 * d'une règle (même contenu, objet différent) et pas seulement une réexportation
 * (même objet). Une fonction n'a pas de forme de données : elle ne peut pas être
 * recopiée, elle est donc hors du champ de cette comparaison.
 */
function canon(value) {
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * Les clés d'un objet exporté qui RÉEXPOSENT une règle : soit le module des
 * règles en entier, soit l'un de ses membres — par référence, ou recopié à
 * l'identique sous un autre nom. C'est la seule définition de « deuxième porte »
 * de ce fichier — le balayage des vrais modules et le contrôle des formes
 * synthétiques ci-dessous passent par elle.
 *
 * Comparer des VALEURS (et non du texte) est ce qui rend la mise en forme du
 * `module.exports` indifférente : spread, alias, `exports.X = rules.X`, module
 * entier, ou tout sur une ligne sont vus pareil ; et comparer la FORME en plus de
 * la référence voyait `{ statuts: [...rules.STATUSES] }`, qu'une copie profonde
 * rendait invisible à une comparaison de références seule.
 */
function reexpositions(exported, rules) {
  const members = Object.keys(rules);
  const fautives = [];
  for (const [cle, valeur] of Object.entries(exported)) {
    if (valeur === rules) {
      fautives.push(`la clé « ${cle} » réexpose le module des règles en entier`);
      continue;
    }
    const parReference = members.find((nom) => valeur === rules[nom]);
    if (parReference) {
      fautives.push(`la clé « ${cle} » réexpose la règle « ${parReference} »`);
      continue;
    }
    const forme = canon(valeur);
    if (forme === undefined) continue;
    const parRecopie = members.find((nom) => canon(rules[nom]) === forme);
    if (parRecopie) {
      fautives.push(`la clé « ${cle} » recopie la règle « ${parRecopie} » : la valeur doit venir de require("./rules"), pas être redéfinie`);
    }
  }
  return fautives;
}

/** Dépendances internes d'un module, déduites de ses `require("./…")` */
function internalDeps(name) {
  return [...code(name).matchAll(/require\(["'](\.[^"']+)["']\)/g)]
    .map((match) => path.basename(match[1]))
    .map((file) => (file.endsWith(".js") ? file : `${file}.js`))
    .filter((file) => fs.existsSync(path.join(LIB_DIR, file)));
}

describe("couche de données", () => {
  test("chaque module est déclaré dans une couche, et rien ne remonte", () => {
    const declared = new Set(Object.keys(LAYERS));
    for (const file of libFiles()) {
      assert.ok(declared.has(file), `${file} n'est déclaré dans aucune couche : ajoutez-le à LAYERS`);
    }
    for (const file of declared) {
      assert.ok(fs.existsSync(path.join(LIB_DIR, file)), `couche déclarée pour un module absent : ${file}`);
    }

    for (const file of libFiles()) {
      for (const dep of internalDeps(file)) {
        assert.ok(
          LAYERS[dep] <= LAYERS[file],
          `${file} (couche ${LAYERS[file]}) importe ${dep} (couche ${LAYERS[dep]}) : une dépendance ne monte jamais`
        );
      }
    }
  });

  test("aucun cycle entre modules", () => {
    const visiting = new Set();
    const done = new Set();
    const stack = [];

    function walk(file) {
      if (done.has(file)) return;
      assert.ok(!visiting.has(file), `cycle de modules : ${[...stack, file].join(" → ")}`);
      visiting.add(file);
      stack.push(file);
      for (const dep of internalDeps(file)) walk(dep);
      stack.pop();
      visiting.delete(file);
      done.add(file);
    }

    for (const file of libFiles()) walk(file);
  });

  test("un module qui nomme une règle la prend chez elle", () => {
    const rules = require("../lib/rules");
    const members = Object.keys(rules);

    for (const file of libFiles()) {
      if (file === "rules.js") continue;
      const source = code(file);
      // Sans quoi la règle arrive par un autre module, et elle a deux chemins.
      for (const member of members) {
        if (!new RegExp(`\\b${member}\\b`).test(source)) continue;
        assert.match(
          source,
          /require\(["']\.\/rules["']\)/,
          `${file} utilise la règle « ${member} » sans require("./rules")`
        );
      }
    }

    // Les deux consommateurs historiques de la porte de service : ils prennent
    // maintenant les règles chez elles, et n'importent le store que pour les
    // candidatures (le cas échéant).
    for (const file of ["pdf.js", "export.js"]) {
      assert.match(read(file), /require\(["']\.\/rules["']\)/, `${file} doit require("./rules")`);
      assert.doesNotMatch(read(file), /require\(["']\.\/store["']\)/, `${file} ne doit pas passer par le store pour les règles`);
    }
  });

  test("aucun module ne réexpose une règle, quelle que soit la forme", () => {
    // Ce contrôle lit les exports RÉELS, pas la mise en page du `module.exports`.
    // Une correspondance de texte ne voyait que la forme historique
    // (`module.exports = {` multi-ligne) et laissait passer le spread, l'alias,
    // `exports.X = rules.X`, le module entier, ou le même objet sur une seule
    // ligne — cinq façons d'ouvrir une deuxième porte. Ce qui est interdit est de
    // POUVOIR obtenir une règle par un autre module : on compare donc des valeurs.
    //
    // `require` des modules est sans effet de bord : aucun n'ouvre la base ni
    // n'écrit un fichier à la simple lecture de ses exports.
    const rules = require("../lib/rules");

    for (const file of libFiles()) {
      if (file === "rules.js") continue;
      const exported = require(path.join(LIB_DIR, file));
      assert.equal(typeof exported, "object", `${file} doit exporter un objet`);
      const fautives = reexpositions(exported, rules);
      assert.deepEqual(
        fautives,
        [],
        `${file} : ${fautives.join(" ; ")} — les consommateurs doivent require("./rules")`
      );
    }

    // Contrôle du contrôle : les six formes de réexport par référence et les trois
    // recopies relevées à l'audit sont vues par le détecteur, et un module qui se
    // sert d'une règle sans la réexposer ne l'est pas. Sans ce bloc, un détecteur
    // affaibli (ne regardant que le module entier, par exemple) resterait vert tant
    // qu'aucun module ne fauterait.
    const formes = {
      "module.exports = { STATUSES } (multi-ligne)": { STATUSES: rules.STATUSES, getStats: () => {} },
      "module.exports = { STATUSES } (une ligne)": Object.assign({}, { STATUSES: rules.STATUSES }),
      "module.exports = { ...rules }": { ...rules, getStats: () => {} },
      "exports.STATUSES = rules.STATUSES": Object.assign({ getStats: () => {} }, { STATUSES: rules.STATUSES }),
      "module.exports = { statuts: rules.STATUSES }": { statuts: rules.STATUSES, getStats: () => {} },
      "module.exports = { rules }": { rules, getStats: () => {} },
      // Recopies : même valeur, objet ou tableau différent — ce qu'une comparaison
      // de références seule laissait passer, alors que la règle reste recopiée.
      "recopie du tableau : { statuts: [...rules.STATUSES] }": { statuts: [...rules.STATUSES], getStats: () => {} },
      "recopie de l'objet : { tons: { ...rules.STATUS_TONE } }": { tons: { ...rules.STATUS_TONE }, getStats: () => {} },
      "recopie profonde : JSON.parse(JSON.stringify(rules.FOLLOWUP_DELAYS))": { delais: JSON.parse(JSON.stringify(rules.FOLLOWUP_DELAYS)), getStats: () => {} },
    };
    for (const [forme, exported] of Object.entries(formes)) {
      assert.ok(reexpositions(exported, rules).length > 0, `forme non vue comme une réexposition : ${forme}`);
    }
    // Contrôles négatifs : une règle LUE sans être réexportée ; et un ÉLÉMENT de
    // règle (`"Postulé"`, une valeur de STATUSES, pas un membre exporté à part
    // entière) — celui-là reste hors de portée : une chaîne ne dit pas d'où elle
    // vient. Une règle scalaire qui EST un membre (`FOLLOWUP_DELAY_DEFAULT = 14`)
    // est en revanche bien vue, par sa forme.
    assert.deepEqual(reexpositions({ getStats: () => rules.STATUSES.length, listApplications: () => {} }, rules), []);
    assert.deepEqual(reexpositions({ intitule: "Postulé" }, rules), [], "un élément de règle recopié seul n'est pas un membre : hors de portée assumé");
  });

  test("le schéma et les règles s'accordent sur les champs de date", () => {
    // `DATE_FIELDS` appartient aux règles (lib/rules.js), et c'est là que ses
    // consommateurs le prennent. Le schéma, lui, marque encore ses champs
    // `type: "date"` : les deux listes doivent donc dire la même chose, sans quoi
    // un champ daté du schéma cesserait d'être normalisé en silence.
    const rules = require("../lib/rules");
    const { FIELD_DEFS } = require("../lib/fields");
    const duSchema = FIELD_DEFS.filter((field) => field.type === "date").map((field) => field.name).sort();
    assert.deepEqual(
      duSchema,
      [...rules.DATE_FIELDS].sort(),
      "les champs « date » du schéma et rules.DATE_FIELDS doivent être le même ensemble"
    );
  });

  test("le code HTTP reste dans le transport, pas dans la couche de données", () => {
    // `statusCode` / `expose` sont une forme de réponse HTTP : les poser ici
    // obligerait la couche de données à connaître le protocole qui l'appelle.
    for (const file of libFiles()) {
      const source = code(file);
      assert.doesNotMatch(source, /\bstatusCode\b/, `${file} pose un statusCode : la couche de données n'a pas à connaître HTTP`);
      assert.doesNotMatch(source, /\berror\.expose\b/, `${file} pose « expose » : le code HTTP appartient au transport`);
    }

    // …et c'est bien le transport qui traduit le sens en statut.
    const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
    const errors = require("../lib/errors");
    assert.deepEqual(Object.keys(errors).sort(), ["BackupRefusedError", "NotFoundError", "ValidationError"]);
    for (const [classe, status] of [["ValidationError", 400], ["NotFoundError", 404], ["BackupRefusedError", 500]]) {
      assert.match(
        server,
        new RegExp(`instanceof ${classe}\\)\\s*return\\s*\\{\\s*status:\\s*${status}`),
        `server.js doit traduire ${classe} en ${status}`
      );
    }
  });
});
