// La disposition du tableau de bord est une donnée d'utilisateur : elle vient du
// navigateur, où elle a pu être écrite par une version précédente de la page — ou
// par personne. Ces tests la relisent comme le fait le démarrage, et vérifient
// l'arithmétique des déplacements (`applyOrder`), qui décide de l'ordre enregistré
// à chaque survol du glisser-déposer : une erreur d'index y produirait une
// disposition qu'on ne pourrait plus ranger autrement qu'en la réinitialisant.
//
// dashboard.js est importé hors navigateur, comme les autres modules de l'écran
// (voir overview-render.test.js) : ce qui est vérifié, c'est la disposition
// calculée et le lien entre le catalogue et la page, pas le dessin du plateau.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const PUBLIC_JS = path.join(PUBLIC, "js");

// lib/rules.js est le module dual : require() le pose aussi en global, ce dont les
// modules de l'écran ont besoin au chargement (statuts, délais de relance…).
globalThis.Rules = require(path.join(ROOT, "lib", "rules.js"));
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };

const load = (file) => import(pathToFileURL(path.join(PUBLIC_JS, file)).href);

const indexHtml = () => fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");

/** Les gabarits de contenu déclarés dans index.html (`<template id="tpl-…">`). */
function templatesInPage() {
  return new Set([...indexHtml().matchAll(/<template id="(tpl-[^"]+)"/g)].map((match) => match[1]));
}

/** La convention que le plateau applique pour trouver le contenu d'un widget. */
const tplId = (id) => `tpl-${id}`;

/* ==========================================================================
   La disposition enregistrée
   ========================================================================== */

test("sans disposition enregistrée, tous les widgets sont affichés dans l'ordre du catalogue", async () => {
  const { parseLayout, defaultLayout, WIDGETS } = await load("dashboard.js");
  const layout = parseLayout(null);

  assert.deepEqual(layout, defaultLayout(), "aucune préférence : la disposition d'origine");
  assert.deepEqual(layout.items.map((item) => item.id), WIDGETS.map((widget) => widget.id));
  assert.ok(layout.items.every((item) => item.on), "première visite : tout le tableau de bord est là");
  assert.ok(layout.items.every((item) => item.size === WIDGETS.find((w) => w.id === item.id).size));
});

test("une disposition enregistrée garde son ordre, ses largeurs et ses widgets retirés", async () => {
  const { parseLayout, WIDGETS } = await load("dashboard.js");
  const saved = {
    v: 1,
    items: [
      { id: "table", size: 6, on: true },
      { id: "stat-total", size: 2, on: true },
      { id: "chart-type", size: 3, on: false },
    ],
  };
  const layout = parseLayout(JSON.stringify(saved));
  const ids = layout.items.map((item) => item.id);

  assert.deepEqual(ids.slice(0, 3), ["table", "stat-total", "chart-type"], "l'ordre rangé à la main est respecté");
  assert.deepEqual(
    ids.slice(3),
    WIDGETS.map((widget) => widget.id).filter((id) => !ids.slice(0, 3).includes(id)),
    "les widgets non enregistrés suivent, dans l'ordre du catalogue"
  );
  assert.equal(layout.items[1].size, 2, "les largeurs choisies sont conservées");
  assert.equal(layout.items[2].on, false, "un widget retiré le reste");
});

test("rien de ce qui vient du navigateur n'est cru sur parole", async () => {
  const { parseLayout } = await load("dashboard.js");
  const layout = parseLayout(
    JSON.stringify({
      items: [
        { id: "chart-type", on: false },
        { id: "widget-inconnu", size: 6, on: true }, // widget d'une autre version
        { id: "chart-status", size: 99 }, // largeur qui n'existe pas
        { id: "insights", size: 1 }, // trop étroite pour ce widget
        { id: "chart-type", size: 6 }, // doublon
        { id: "table" },
      ],
    })
  );
  const ids = layout.items.map((item) => item.id);
  const byId = new Map(layout.items.map((item) => [item.id, item]));

  assert.equal(new Set(ids).size, ids.length, "aucun doublon");
  assert.ok(!ids.includes("widget-inconnu"), "un widget inconnu est oublié");
  assert.equal(ids[0], "chart-type", "l'ordre enregistré est conservé");
  assert.equal(byId.get("chart-status").size, 3, "largeur inconnue : celle par défaut");
  assert.equal(byId.get("insights").size, 3, "largeur sous le minimum du widget : celle par défaut");
  assert.equal(byId.get("table").size, 6);
  assert.ok(byId.get("table").on, "un widget sans drapeau est affiché");
  assert.equal(byId.get("chart-type").on, false, "le premier état enregistré fait foi");
});

test("des préférences illisibles ne cassent pas le tableau de bord", async () => {
  const { parseLayout, defaultLayout } = await load("dashboard.js");
  for (const raw of ["{pas du json", "null", '"texte"', "[]", JSON.stringify({ items: [] }), JSON.stringify({ items: "non" })]) {
    assert.deepEqual(parseLayout(raw), defaultLayout(), `« ${raw} » doit rendre la disposition d'origine`);
  }
});

/* ==========================================================================
   Déplacements
   ========================================================================== */

test("un dépôt place la carte avant ou après celle qu'on vise", async () => {
  const { applyOrder } = await load("dashboard.js");
  const ids = ["a", "b", "c", "d"];

  assert.deepEqual(applyOrder(ids, "d", "a", false), ["d", "a", "b", "c"], "saisie en fin de liste, lâchée au début");
  assert.deepEqual(applyOrder(ids, "a", "c", true), ["b", "c", "a", "d"], "saisie au début, lâchée après « c »");
  assert.deepEqual(applyOrder(ids, "b", "a", true), ids, "lâchée juste après sa voisine : rien ne bouge");
  assert.deepEqual(applyOrder(ids, "a", null, false), ["b", "c", "d", "a"], "lâchée sous les cartes : en fin de plateau");
  assert.deepEqual(applyOrder(ids, "b", "b", true), ids, "lâchée sur elle-même : rien ne bouge");
  assert.deepEqual(applyOrder(ids, "z", "a", true), ids, "un widget absent du plateau ne s'invente pas une place");
});

test("une liste réordonnée ne perd ni ne déplace les widgets retirés", async () => {
  const { orderItems } = await load("dashboard.js");
  const items = [
    { id: "a", on: true },
    { id: "b", on: false },
    { id: "c", on: true },
    { id: "d", on: false },
  ];
  const next = orderItems(items, ["c", "a"]);

  assert.deepEqual(next.map((item) => item.id), ["c", "a", "b", "d"], "les affichés d'abord, les retirés ensuite");
  assert.equal(next.length, items.length, "aucun widget n'est perdu au passage");
  assert.equal(next.find((item) => item.id === "d").on, false, "un retiré ne redevient pas affiché en changeant de place");
});

test("« Réinitialiser » ne se propose que quand la disposition a bougé", async () => {
  const { isDefaultLayout, defaultLayout, parseLayout } = await load("dashboard.js");
  const defaultJson = JSON.stringify(defaultLayout());

  assert.ok(isDefaultLayout(defaultLayout()), "la disposition d'origine est la disposition d'origine");
  assert.ok(isDefaultLayout(parseLayout(defaultJson)), "et elle survit à un aller-retour par le navigateur");

  const reordered = defaultLayout();
  [reordered.items[0], reordered.items[1]] = [reordered.items[1], reordered.items[0]];
  assert.ok(!isDefaultLayout(reordered), "un ordre changé compte");

  const hidden = defaultLayout();
  hidden.items[0].on = false;
  assert.ok(!isDefaultLayout(hidden), "un widget retiré compte");

  const resized = defaultLayout();
  resized.items[0].size = 6;
  assert.ok(!isDefaultLayout(resized), "une largeur changée compte");
});

/* ==========================================================================
   Le catalogue et la page
   ========================================================================== */

test("la page ne déclare aucun widget : c'est le catalogue qui les monte", () => {
  assert.doesNotMatch(
    indexHtml(),
    /data-widget=/,
    "index.html ne doit plus écrire de carte : une seule liste dit quels widgets existent (dashboard.js), et rien ne doit plus être repris de la page au démarrage"
  );
});

test("chaque widget du catalogue a son gabarit de contenu dans la page — et l'inverse", async () => {
  const { WIDGETS } = await load("dashboard.js");
  const templates = templatesInPage();

  for (const widget of WIDGETS) {
    assert.ok(
      templates.has(tplId(widget.id)),
      `« ${widget.id} » chercherait le gabarit « ${tplId(widget.id)} », absent de index.html : la carte se monterait vide`
    );
    assert.ok(widget.size >= widget.min, `« ${widget.id} » a une largeur d'origine sous son propre minimum`);
  }
  for (const id of templates) {
    assert.ok(
      WIDGETS.some((widget) => tplId(widget.id) === id),
      `le gabarit « ${id} » n'est le contenu d'aucun widget du catalogue : il ne serait jamais monté`
    );
  }
});

test("chaque indicateur a son conteneur, sinon sa carte ne serait jamais dessinée", async () => {
  const { WIDGETS } = await load("dashboard.js");
  const html = indexHtml();

  for (const widget of WIDGETS) {
    if (!widget.id.startsWith("stat-")) continue;
    // renderStats() écrit dans #stat-<id> ; un id absent de la page rendrait la
    // carte silencieusement vide.
    assert.ok(html.includes(`id="${widget.id}"`), `« ${widget.id} » doit avoir un conteneur id="${widget.id}"`);
  }
});

/* ==========================================================================
   Cycle de vie : qui construit quoi, et qui le sait
   --------------------------------------------------------------------------
   Le plateau détache ses cartes du document et les rattache, sans savoir ce
   qu'elles contiennent. Deux contrats en découlent :

    1. ce qu'il y a dans une carte se construit depuis le rendu de l'écran qui le
       possède, à CHAQUE rendu (le plateau a déjà appelé `initTable()` quand on
       remettait le widget de la liste, et le tableau n'était alors construit que
       par ce chemin-là — « Réinitialiser », qui rattache la carte sans passer par
       le menu, laissait un conteneur vide sous un compteur qui annonçait des
       lignes : vérifié sur la page) ;
    2. savoir si une carte est affichée n'est plus une inspection du document : le
       plateau l'annonce (`watchWidget`), et chaque écran s'y abonne (voir app.js).
   ========================================================================== */

/** Le corps d'une fonction exportée : de sa signature au début de la suivante. */
function blockOf(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `« ${signature} » doit exister`);
  const next = source.indexOf("\nexport function", start + signature.length);
  return source.slice(start, next === -1 ? undefined : next);
}

const moduleSource = (file) => fs.readFileSync(path.join(PUBLIC_JS, file), "utf8");

test("le plateau ne construit ni ne dessine rien — il détache et rattache", () => {
  const source = moduleSource("dashboard.js");
  assert.doesNotMatch(
    source,
    /initTable|new Tabulator|new Chart\(/,
    "dashboard.js ne doit connaître aucun écran : le widget de la liste, remis par le plateau, doit se construire depuis son propre rendu"
  );
});

test("le tableau se construit depuis son rendu, à chaque fois que le plateau le lui annonce", () => {
  assert.match(
    blockOf(moduleSource("table.js"), "export function renderTable()"),
    /const built = initTable\(rows\)/,
    "renderTable doit construire le tableau avec les lignes de la sélection : sans cet appel, un conteneur rattaché hors du menu « Widgets » reste vide"
  );
  // Et personne d'autre ne le construit : ni le plateau, ni le point d'assemblage
  // (au démarrage, la disposition enregistrée peut très bien ne pas contenir le
  // widget — il n'y aurait rien à construire, sinon au mauvais endroit).
  assert.doesNotMatch(
    fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"),
    /initTable/,
    "app.js ne doit pas construire le tableau : la construction appartient au rendu, qui voit le conteneur"
  );
});

test("aucun écran ne devine si sa carte est affichée : le plateau le lui dit", () => {
  for (const file of ["dashboard.js", "table.js", "overview.js", "ui.js"]) {
    assert.doesNotMatch(
      moduleSource(file),
      /isConnected|isAttached/,
      `${file} ne doit pas relire le document pour savoir si son conteneur est dans la page : le plateau annonce la vie de ses cartes (watchWidget)`
    );
  }
  assert.match(moduleSource("table.js"), /export function bindTableWidget/, "la liste s'abonne au contrat de vie du plateau");
  assert.match(moduleSource("overview.js"), /export function bindCharts/, "les graphiques s'abonnent au contrat de vie du plateau");
  assert.match(
    fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"),
    /bindTableWidget\(watchWidget\)/,
    "et c'est le câblage (app.js) qui met les deux en relation, comme pour le thème"
  );
});
