// Le front-end n'a ni bundler ni étape de compilation : le navigateur charge
// `public/app.js` en module ES et suit ses `import`. Une coquille dans un nom
// importé ne se voit donc qu'à l'exécution, dans la console. Ces tests
// recontrôlent le graphe de modules sur le disque.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const JS_DIR = path.join(PUBLIC, "js");
const ENTRY = path.join(PUBLIC, "app.js");

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Noms exportés par un module : `export function/const/let/class` et `export { … }`. */
function exportedNames(source) {
  const names = new Set();
  const code = stripComments(source);
  for (const match of code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(match[1]);
  }
  for (const match of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      names.add(trimmed.split(/\s+as\s+/).pop().trim());
    }
  }
  return names;
}

/** Imports nommés d'un module : `import { a, b as c } from "./x.js"`. */
function namedImports(file) {
  const source = stripComments(fs.readFileSync(file, "utf8"));
  const imports = [];
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    const from = match[2];
    if (!from.startsWith(".")) continue; // modules externes : rien à vérifier ici
    const names = match[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    imports.push({ from, names, target: path.resolve(path.dirname(file), from) });
  }
  return imports;
}

function moduleFiles() {
  return [ENTRY, ...fs.readdirSync(JS_DIR).filter((f) => f.endsWith(".js")).map((f) => path.join(JS_DIR, f)).sort()];
}

test("chaque import nommé trouve son export", () => {
  for (const file of moduleFiles()) {
    for (const { from, names, target } of namedImports(file)) {
      const relative = path.relative(ROOT, file);
      assert.ok(fs.existsSync(target), `${relative} importe « ${from} », qui n'existe pas`);
      const available = exportedNames(fs.readFileSync(target, "utf8"));
      for (const name of names) {
        assert.ok(
          available.has(name),
          `${relative} importe « ${name} » depuis « ${from} », qui ne l'exporte pas`
        );
      }
    }
  }
});

test("le point d'entrée est un module ES chargé après les scripts classiques", () => {
  const indexHtml = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.match(
    indexHtml,
    /<script type="module" src="\/app\.js"><\/script>/,
    "app.js doit être chargé en module : sans bundler, ce sont ses import qui font le reste"
  );
  // Chart.js, Tabulator et Rules sont des globaux posés par des scripts classiques :
  // ils doivent être chargés avant que le module (différé) ne s'exécute.
  for (const classic of ["/rules.js", "/chart.js", "/tabulator.js"]) {
    assert.ok(
      indexHtml.indexOf(classic) < indexHtml.indexOf('type="module" src="/app.js"'),
      `${classic} doit être chargé avant le module app.js`
    );
  }
});

test("les dépendances ne remontent jamais d'une couche basse vers un écran", () => {
  // L'ossature (chrome, modales, menus, thème) et l'accès aux données sont
  // importés par tous les écrans : s'ils se mettent à importer un écran, une
  // évolution des graphiques force une modification du fichier dont tout le
  // monde dépend — c'est l'inversion que ce découpage a corrigée.
  const LAYERS = [
    ["couche basse", ["state.js", "render.js", "ui.js"]],
    ["ossature / accès aux données", ["api.js", "shell.js"]],
    ["écran", null], // tout le reste
  ];
  const layerOf = (file) => {
    const name = path.basename(file);
    const index = LAYERS.findIndex(([, names]) => names && names.includes(name));
    return index === -1 ? LAYERS.length - 1 : index;
  };

  for (const file of moduleFiles().filter((f) => f !== ENTRY)) {
    const relative = path.relative(ROOT, file);
    for (const { from, target } of namedImports(file)) {
      assert.ok(
        layerOf(target) <= layerOf(file),
        `${relative} importe « ${from} », qui est d'une couche supérieure : les écrans dépendent de l'ossature, jamais l'inverse`
      );
    }
  }

  // L'ossature ne doit connaître aucun écran : le redessin des graphiques lui est
  // passé par `app.js` sous forme de rappel, pas importé depuis `overview.js`.
  const shell = fs.readFileSync(path.join(JS_DIR, "shell.js"), "utf8");
  assert.doesNotMatch(
    shell,
    /from "\.\/overview\.js"/,
    "shell.js ne doit pas importer les graphiques : c'est app.js qui câble ce rappel"
  );
  const entry = fs.readFileSync(ENTRY, "utf8");
  assert.match(
    entry,
    /bindShell\(\{\s*onThemeChange:\s*refreshDashboard\s*\}\)/,
    "app.js doit passer le redessin des graphiques à l'ossature"
  );
});

test("le module d'entrée ne dessine plus les écrans lui-même", () => {
  const entry = fs.readFileSync(ENTRY, "utf8");
  // app.js doit rester le point d'assemblage : s'il se remet à porter une modale,
  // un tableau ou un export, c'est que le découpage est en train de se défaire.
  assert.doesNotMatch(entry, /new Tabulator|new Chart\(|confirmDialog\(/);
  const imports = namedImports(ENTRY).map((i) => i.from);
  for (const module of ["./js/table.js", "./js/overview.js", "./js/backups.js"]) {
    assert.ok(imports.includes(module), `app.js devrait importer ${module}`);
  }
});
