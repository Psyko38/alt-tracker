// Le cycle de vie des cartes : qui est attaché, qui le sait, et quand.
// --------------------------------------------------------------------------
// Le plateau est seul à savoir si une carte est dans le document, et il l'annonce
// (`watchWidget`) — c'est la seule chose que les écrans croient. Ces tests exercent
// cette charnière pour de vrai : dashboard.js est importé hors navigateur avec un DOM
// minimal (comme table-render.test.js le fait pour Tabulator), le plateau est monté
// par `initDashboard`, et ce qui est annoncé est écouté.
//
// Deux familles de vérifications, dont aucune ne se contente de relire le code :
//
//  1. l'annonce suit le plateau : retirer ou remettre annonce une fois, un simple
//     réordonnancement n'annonce RIEN, et le plateau vidé annonce chaque sortie.
//     Y compris le cas qui a été un vrai défaut : un widget dont le gabarit manque
//     n'a pas de carte, donc il ne doit jamais être annoncé attaché — c'est ce que
//     ce test a attrapé quand l'ensemble annoncé était dérivé de la disposition
//     *voulue* au lieu des cartes réellement montées ;
//  2. la disposition visible suit la disposition enregistrée SANS invalidation
//     manuelle (`shiftWidget`, `resetLayout`) : la signature du dernier rangement
//     porte l'ordre et les largeurs, donc elle suffit — si elle l'oubliait, l'écran
//     resterait sur place et le test le verrait.
"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const assert = require("node:assert/strict");

const PUBLIC_JS = path.join(__dirname, "..", "public", "js");

// lib/rules.js est le module dual : require() le pose aussi en global, ce dont les
// modules de l'écran ont besoin au chargement (statuts, délais de relance…).
globalThis.Rules = require(path.join(__dirname, "..", "lib", "rules.js"));

// Retirer un widget pose une notification qui s'efface après 3,4 s. On ne l'exécute
// pas : le minuteur ne servirait qu'à retenir la fin de la suite, et rien ici ne
// dépend de sa disparition ni des faux éléments qu'il touche.
globalThis.setTimeout = () => 0;

/* --- DOM minimal ---------------------------------------------------------- */

function makeEl(tag = "div") {
  const classes = new Set();
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    dataset: {},
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, on) {
        const want = on === undefined ? !classes.has(name) : Boolean(on);
        if (want) classes.add(name);
        else classes.delete(name);
        return want;
      },
    },
    append(...nodes) {
      for (const node of nodes) el.appendChild(node);
    },
    appendChild(node) {
      node.parentNode = el;
      el.children.push(node);
      return node;
    },
    prepend(...nodes) {
      for (const node of nodes.slice().reverse()) {
        node.parentNode = el;
        el.children.unshift(node);
      }
    },
    // `insertBefore` d'un nœud déjà placé le retire d'abord : c'est la sémantique du
    // vrai DOM, et c'est sur elle que repose tout le rangement du plateau (les enfants
    // du plateau SONT l'ordre affiché).
    insertBefore(node, ref) {
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
      const at = ref ? el.children.indexOf(ref) : -1;
      el.children.splice(at === -1 ? el.children.length : at, 0, node);
      node.parentNode = el;
      return node;
    },
    remove() {
      if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((child) => child !== el);
      el.parentNode = null;
    },
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    closest: () => null,
  };
  return el;
}

/** Le plateau et la page. `host` change à chaque cas (voir `resetPage`). */
let host = makeEl("div");
const missingTemplates = new Set();
const store = new Map();

globalThis.document = {
  body: makeEl("body"),
  createElement: (tag) => makeEl(tag),
  // Un gabarit présent rend un contenu clonable ; `missingTemplates` sert au cas de
  // l'item 1 : un widget du catalogue dont le `<template>` n'existe pas.
  getElementById(id) {
    if (id === "bento") return host;
    if (id.startsWith("tpl-")) {
      return missingTemplates.has(id.slice(4)) ? null : { content: { cloneNode: () => makeEl() } };
    }
    return null;
  },
  querySelector: (selector) => (selector === "#bento" ? host : makeEl()),
  querySelectorAll: () => [],
};

globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

/* --- Chargement ----------------------------------------------------------- */

const stateUrl = () => pathToFileURL(path.join(PUBLIC_JS, "state.js")).href;

// Une instance NEUVE du plateau par cas : `nodes`, `drawnLayout` et les abonnés sont
// l'état du module, et un test qui hérite des cartes du précédent ne prouverait rien.
let generation = 0;
const freshBoard = () => import(`${pathToFileURL(path.join(PUBLIC_JS, "dashboard.js")).href}?cas=${++generation}`);

/** Une page neuve : plateau vide, préférences oubliées, tous les gabarits présents. */
function resetPage() {
  host = makeEl("div");
  store.clear();
  missingTemplates.clear();
}

/* --- Lecture du plateau --------------------------------------------------- */

const domOrder = () => host.children.map((child) => child.dataset.widget);

/** S'abonner comme le fait app.js : après le montage, sur tous les widgets. */
function listen(board) {
  const log = [];
  for (const widget of board.WIDGETS) {
    board.watchWidget(widget.id, (inBoard) => log.push(`${widget.id}:${inBoard}`));
  }
  return log;
}

/* ==========================================================================
   L'annonce suit le plateau
   ========================================================================== */

test("retirer ou remettre une carte est annoncé une fois, et rien d'autre ne l'est", async () => {
  const board = await freshBoard();
  const { state } = await import(stateUrl());
  resetPage();
  board.initDashboard();

  const log = listen(board);
  assert.deepEqual(
    log,
    board.WIDGETS.map((widget) => `${widget.id}:true`),
    "à l'abonnement, chaque carte montée est annoncée affichée (appel immédiat de watchWidget)"
  );

  log.length = 0;
  board.setWidgetEnabled("insights", false);
  assert.deepEqual(log, ["insights:false"], "retirer la carte annonce sa sortie, une seule fois");
  assert.ok(!domOrder().includes("insights"), "et elle quitte le plateau");

  log.length = 0;
  board.setWidgetEnabled("insights", true);
  assert.deepEqual(log, ["insights:true"], "la remettre annonce son entrée, une seule fois");
  assert.ok(domOrder().includes("insights"), "et elle revient dans le plateau");

  log.length = 0;
  board.renderDashboardLayout();
  assert.deepEqual(log, [], "un rendu qui ne change ni les widgets ni leurs largeurs n'annonce rien");

  log.length = 0;
  board.setWidgetSize("chart-monthly", 2);
  assert.deepEqual(log, [], "changer une largeur n'annonce ni entrée ni sortie");

  // Réordonnancement : tout bouge à l'écran, personne n'entre ni ne sort.
  log.length = 0;
  const before = domOrder();
  assert.equal(board.shiftWidget("insights", -1), true, "le déplacement clavier change l'ordre");
  assert.deepEqual(log, [], "un simple réordonnancement n'annonce rien du tout");
  assert.notDeepEqual(domOrder(), before, "mais le plateau a bien bougé");
  assert.deepEqual(
    domOrder(),
    state.layout.items.filter((item) => item.on).map((item) => item.id),
    "et l'ordre affiché est celui de la disposition enregistrée, sans invalidation manuelle"
  );
});

test("le plateau vidé annonce chaque sortie, la dernière comprise — et les rend toutes au retour", async () => {
  const board = await freshBoard();
  const { state } = await import(stateUrl());
  resetPage();
  board.initDashboard();
  const log = listen(board);
  log.length = 0;

  const shown = state.layout.items.filter((item) => item.on).map((item) => item.id);
  for (const id of shown) board.setWidgetEnabled(id, false);

  assert.equal(host.children.length, 0, "plus une seule carte dans le plateau");
  assert.equal(log.length, shown.length, "une annonce par widget sorti — ni doublon, ni oubli");
  assert.ok(log.every((entry) => entry.endsWith(":false")), "et ce sont toutes des sorties");
  assert.ok(
    shown.every((id) => log.includes(`${id}:false`)),
    "le dernier sorti est annoncé comme les autres : aucun widget ne reste sans nouvelle"
  );

  log.length = 0;
  board.resetLayout();
  assert.deepEqual(
    log,
    board.WIDGETS.map((widget) => `${widget.id}:true`),
    "« Réinitialiser » annonce chaque carte qui revient, une fois chacune"
  );
  assert.deepEqual(domOrder(), board.WIDGETS.map((widget) => widget.id), "et le plateau reprend l'ordre du catalogue");
});

test("une carte retirée puis remise dans la foulée est annoncée deux fois, dans l'ordre", async () => {
  const board = await freshBoard();
  resetPage();
  board.initDashboard();
  const log = listen(board);
  log.length = 0;

  board.setWidgetEnabled("table", false);
  board.setWidgetEnabled("table", true);

  assert.deepEqual(log, ["table:false", "table:true"], "sortie puis entrée : ni l'une sautée, ni l'autre doublée");
  assert.ok(domOrder().includes("table"), "la carte est de retour dans le plateau");
});

/* ==========================================================================
   La carte existe-t-elle ? C'est elle qui est annoncée, pas l'intention
   ========================================================================== */

test("un widget dont le gabarit manque n'est jamais annoncé attaché", async () => {
  const board = await freshBoard();
  resetPage();
  missingTemplates.add("insights");
  board.initDashboard();

  assert.ok(!domOrder().includes("insights"), "sans gabarit, aucune carte n'est montée");

  const log = listen(board);
  assert.ok(log.includes("insights:false"), "l'abonnement le voit absent, comme le plateau");
  assert.ok(!log.includes("insights:true"), "et jamais présent");

  // Le cas qui comptait : un widget monté qui entre ou sort ne doit pas entraîner
  // l'annonce d'un widget sans carte. Avec un ensemble annoncé dérivé de la
  // disposition voulue, ce `true` sortait ici — la carte n'existait pas.
  log.length = 0;
  board.setWidgetEnabled("table", false);
  board.setWidgetEnabled("table", true);
  assert.deepEqual(
    log.filter((entry) => entry.startsWith("insights")),
    [],
    "un autre changement du plateau ne peut pas l'annoncer attaché"
  );
  assert.deepEqual(log, ["table:false", "table:true"], "et il annonce exactement ce qui a bougé");
});
