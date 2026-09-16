// Le contrat clavier des modales — tabulation retenue, Échap, focus rendu à
// l'ouvreur — est écrit une fois dans shell.js (`bindDialog`). Ces tests vérifient
// que chaque boîte de dialogue de la page y passe, et qu'aucune ne se rebranche à
// la main : c'est ainsi que le piège de focus avait manqué aux sauvegardes.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const JS_DIR = path.join(PUBLIC, "js");

function frontEndSources() {
  const files = [path.join(PUBLIC, "app.js"), ...fs.readdirSync(JS_DIR).map((f) => path.join(JS_DIR, f))];
  return files.map((f) => fs.readFileSync(f, "utf8"));
}

/** Les boîtes de dialogue de la page : les éléments `class="modal"` qui ont un id. */
function dialogIds() {
  const indexHtml = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  return [...indexHtml.matchAll(/<div id="([^"]+)" class="modal\b/g)].map((m) => m[1]);
}

test("chaque boîte de dialogue de la page prend le contrat clavier partagé", () => {
  const ids = dialogIds();
  assert.ok(ids.length >= 5, `au moins 5 boîtes de dialogue attendues, ${ids.length} trouvées`);
  const all = frontEndSources().join("\n");
  for (const id of ids) {
    const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    assert.match(
      all,
      new RegExp(`bindDialog\\(els\\.${key}\\b`),
      `« ${id} » doit passer par bindDialog(els.${key}, …) : sinon Tab en sort et Échap ne la ferme pas`
    );
  }
});

test("le contrat clavier n'est écrit qu'une fois", () => {
  const all = frontEndSources().join("\n");
  assert.doesNotMatch(
    all,
    /trapFocusIn/,
    "le piège de focus passe par bindDialog : le rebrancher modale par modale, c'est l'oublier à la sixième"
  );
  assert.doesNotMatch(
    all,
    /if \(e\.target === els\./,
    "la fermeture sur clic de fond appartient à bindDialog"
  );
});
