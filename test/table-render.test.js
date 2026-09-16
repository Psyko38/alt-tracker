// Le tableau n'est reconstruit que si ce qu'il affiche change.
// --------------------------------------------------------------------------
// `applicationsTable.setData()` refait tout le tableau : mesuré sur la page, ~40 ms
// d'un rendu de ~41 ms, avec 563 relectures de la mise en page (`offsetHeight`) pour
// 12 lignes. Or plusieurs rendus ne changent aucune ligne — basculer une colonne qui
// n'entre pas dans le contenu des cellules, recharger un jeu identique, taper une
// lettre qui ne réduit pas la sélection : les rejouer coûte 40 ms et ramène au
// passage le tableau à la page 1.
//
// Ce test importe table.js hors navigateur avec un DOM et un Tabulator minimaux :
// ce qui est vérifié, c'est le nombre d'appels à setData, pas le dessin du tableau.
"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const assert = require("node:assert/strict");

const PUBLIC_JS = path.join(__dirname, "..", "public", "js");

// lib/rules.js est le module dual : require() le pose aussi en global, ce dont
// state.js, ui.js et table.js ont besoin (STATUSES, fmtDateFR, selectApps…).
globalThis.Rules = require(path.join(__dirname, "..", "lib", "rules.js"));

/* --- DOM minimal ---------------------------------------------------------- */

function fakeEl() {
  const classes = new Set();
  return {
    textContent: "",
    innerHTML: "",
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle(c, on) {
        const want = on === undefined ? !classes.has(c) : on;
        if (want) classes.add(c);
        else classes.delete(c);
        return want;
      },
    },
    querySelector: () => fakeEl(),
    setAttribute: () => {},
  };
}

globalThis.document = { querySelector: () => fakeEl(), createElement: () => fakeEl() };

/* --- Tabulator minimal ---------------------------------------------------- */

const component = { show() {}, hide() {}, isVisible: () => true };

class FakeTabulator {
  constructor(selector, config) {
    this.selector = selector;
    this.config = config;
    this.calls = [];
    // Le tableau n'est pas prêt dans la passe qui suit sa construction : Tabulator
    // l'avertit lui-même (« Table Not Initialized - Calling the setData function
    // before the table is initialized may result in inconsistent behavior »), et
    // dans cette page la passe a levé (« Cannot read properties of null (reading
    // 'verticalFillMode') ») en laissant les lignes marquées comme envoyées. Le faux
    // est donc plus strict que le vrai — il refuse au lieu d'avertir — pour que
    // cette classe d'ordre ne puisse pas revenir en silence (voir `initTable`).
    this.built = false;
    queueMicrotask(() => { this.built = true; });
    FakeTabulator.last = this;
  }
  setData(rows) {
    FakeTabulator.requireBuilt(this);
    this.calls.push(rows);
    this.data = rows;
    // Tabulator ne peint rien dans un conteneur sans dimensions : masqué
    // (`display: none`), `#applications-table` mesure 0 px et les lignes ne sont pas
    // dessinées — et réafficher le conteneur ensuite ne les redessine pas (mesuré sur
    // la page). `displayed` est donc ce que l'écran montre réellement, à l'instant du
    // rafraîchissement.
    this.displayed = FakeTabulator.containerHidden() ? [] : rows;
  }
  getColumn() {
    FakeTabulator.requireBuilt(this);
    return component;
  }
  /** Tabulator n'est pas prêt avant sa passe de construction : le vrai lève, le faux aussi. */
  static requireBuilt(table) {
    if (!table.built) {
      throw new TypeError("Cannot read properties of null (reading 'verticalFillMode')");
    }
  }
}
FakeTabulator.containerHidden = () => false;
globalThis.Tabulator = FakeTabulator;

const load = (file) => import(pathToFileURL(path.join(PUBLIC_JS, file)).href);

/* --- Jeu d'essai ---------------------------------------------------------- */

const app = (id, over = {}) => ({
  id,
  company: `Entreprise ${id}`,
  position: "Développeur",
  status: "Postulé",
  type: "Alternance",
  dateDemarche: "2026-09-01",
  contactName: "",
  notes: "",
  ...over,
});

test("le tableau n'est reconstruit que si ce qu'il affiche change", async () => {
  const table = await load("table.js");
  const { state, els } = await load("state.js");

  // Le registre des éléments est normalement rempli par cacheElements() ; ici on
  // ne pose que ce que renderTable() et showEmpty() touchent.
  for (const name of ["listCount", "listTitle", "empty", "tableWrap", "emptyTitle", "emptyText", "emptyAction", "emptyDemo"]) {
    els[name] = fakeEl();
  }

  state.apps = [app("1"), app("2")];
  state.columns = ["company", "position"];
  state.filters = { q: "", status: "", type: "", followup: false, from: "", to: "", dateField: "dateDemarche" };
  state.quick = "";
  state.sort = { key: "", dir: "asc" };
  state.selectSort = "";

  // Le plateau est seul à savoir si la carte est dans le document, et il l'annonce :
  // ici, elle est affichée (voir bindTableWidget dans table.js).
  table.bindTableWidget((id, announce) => announce(true));

  // Premier rendu, sur un tableau qui n'existe pas encore : c'est le chemin de l'app
  // (personne d'autre n'appelle initTable, voir dashboard-layout.test.js). Les lignes
  // partent AVEC le constructeur, et rien ne touche le tableau dans cette passe :
  // c'est le contrat que `initTable` documente, et le faux le refuse.
  table.renderTable();
  const t = FakeTabulator.last;
  const dessins = () => t.calls.length;
  assert.equal(dessins(), 0, "le tableau naît avec ses lignes, sans setData");
  assert.deepEqual(t.config.data.map((row) => row.company), ["Entreprise 1", "Entreprise 2"], "ce sont les lignes de la sélection");

  // On laisse passer la passe de construction : dans la page, le rendu suivant vient
  // toujours d'une autre tâche que celle qui a monté le tableau (ici, le harnais
  // enchaîne deux rendus). C'est la seule concession que fait ce fichier au faux
  // asynchrone — et elle est écrite, pas subie.
  await Promise.resolve();

  // Mêmes lignes, même ordre : c'est le cas d'un rendu déclenché par autre chose
  // que les données (menu « Colonnes », rechargement à l'identique).
  table.renderTable();
  table.renderTable();
  assert.equal(dessins(), 0, "mêmes lignes : le tableau ne doit pas être reconstruit");

  // Une ligne change : là, il faut rafraîchir.
  state.apps = [app("1", { status: "Refus" }), app("2")];
  table.renderTable();
  assert.equal(dessins(), 1, "un statut modifié doit rafraîchir le tableau");

  // La sélection change : idem.
  state.filters.q = "Entreprise 1";
  table.renderTable();
  assert.equal(dessins(), 2, "une recherche qui réduit la sélection doit rafraîchir");
  assert.equal(t.calls[1].length, 1, "et le tableau ne reçoit que la ligne retenue");
  assert.match(els.listCount.textContent, /^1 candidature affichée sur 2/);

  state.filters.q = "";
  table.renderTable();
  assert.equal(dessins(), 3, "vider la recherche remet les deux lignes");

  // Masquer une colonne qui n'entre pas dans le contenu des cellules ne change
  // aucune cellule : rien à reconstruire.
  state.columns = ["company", "position", "source"];
  table.renderTable();
  assert.equal(dessins(), 3, "une colonne en plus ne change pas le contenu des cellules");

  // « Notes » est l'exception : masquée, la cellule « Entreprise » porte un repère
  // de note. Le contenu des cellules change, donc le tableau doit être reconstruit.
  state.columns = ["company", "position", "source", "notes"];
  table.renderTable();
  assert.equal(dessins(), 4, "afficher « Notes » change la cellule « Entreprise » : il faut redessiner");

  state.columns = ["company", "position", "source"];
  table.renderTable();
  assert.equal(dessins(), 5, "et la masquer à nouveau aussi");

  // Le contenu envoyé au tableau est bien celui de la sélection : dernier appel.
  assert.equal(t.calls[t.calls.length - 1].length, 2);
  assert.equal(t.calls[t.calls.length - 1][0].contact, "", "chaque ligne porte le champ `contact` attendu par la colonne");
});

test("sortir de l'état vide affiche les lignes, il ne les charge pas seulement", async () => {
  const table = await load("table.js");
  const { state, els } = await load("state.js");

  for (const name of ["listCount", "listTitle", "empty", "tableWrap", "emptyTitle", "emptyText", "emptyAction", "emptyDemo"]) {
    els[name] = fakeEl();
  }
  // Le faux Tabulator suit la visibilité réelle du conteneur : c'est elle qui décide
  // si les lignes sont peintes.
  FakeTabulator.containerHidden = () => els.tableWrap.classList.contains("hidden");

  state.columns = ["company", "position"];
  state.filters = { q: "", status: "", type: "", followup: false, from: "", to: "", dateField: "dateDemarche" };
  state.quick = "";
  state.sort = { key: "", dir: "asc" };
  state.selectSort = "";

  // Suivi vide : rien à afficher, et le conteneur est masqué (c'est cet état masqué
  // qui rendait le rafraîchissement suivant invisible). Le tableau existe depuis le
  // premier test — le module le garde — donc ce rendu prend le chemin des lignes,
  // pas celui de la construction.
  state.apps = [];
  table.bindTableWidget((id, announce) => announce(true));
  const t = FakeTabulator.last;
  table.renderTable();
  assert.ok(els.tableWrap.classList.contains("hidden"), "suivi vide : le conteneur est masqué");
  assert.equal(t.displayed.length, 0);

  // Première candidature : l'écran doit la montrer. Le conteneur doit être réaffiché
  // avant le rafraîchissement, sinon les lignes sont chargées mais jamais dessinées.
  state.apps = [app("1")];
  table.renderTable();
  assert.equal(t.data.length, 1, "la ligne est bien envoyée au tableau");
  assert.equal(t.displayed.length, 1, "et elle doit être peinte, pas seulement chargée");
  assert.match(els.listCount.textContent, /^1 candidature affichée sur 1/, "le compteur et l'écran doivent dire la même chose");

  // Même exigence en sortant de l'état « aucun résultat ».
  state.filters.q = "introuvable";
  table.renderTable();
  assert.equal(t.displayed.length, 0, "aucun résultat : rien n'est affiché");
  state.filters.q = "";
  table.renderTable();
  assert.equal(t.displayed.length, 1, "réinitialiser les filtres doit repeindre les lignes");
});

test("un widget retiré ne peint rien, et son retour repart des lignes affichées", async () => {
  const table = await load("table.js");
  const { state, els } = await load("state.js");

  for (const name of ["listCount", "listTitle", "empty", "tableWrap", "emptyTitle", "emptyText", "emptyAction", "emptyDemo"]) {
    els[name] = fakeEl();
  }
  FakeTabulator.containerHidden = () => els.tableWrap.classList.contains("hidden");
  state.apps = [app("1"), app("2")];
  state.columns = ["company", "position"];
  state.filters = { q: "", status: "", type: "", followup: false, from: "", to: "", dateField: "dateDemarche" };
  state.quick = "";
  state.sort = { key: "", dir: "asc" };
  state.selectSort = "";

  // Le plateau annonce que la carte vient de sortir du document : son conteneur
  // mesure 0 px, où que ce soit, et rien de ce qu'on y enverrait ne se verrait.
  table.bindTableWidget((id, announce) => announce(false));
  const t = FakeTabulator.last;
  const dessins = t.calls.length;
  table.renderTable();
  assert.equal(t.calls.length, dessins, "widget retiré : aucune ligne n'est envoyée au tableau");

  // Il revient : le rendu qui l'apprend repeint ses lignes (et non « rien », parce
  // que le premier rendu l'a cru dehors et a oublié ce qui était dessiné).
  table.bindTableWidget((id, announce) => announce(true));
  table.renderTable();
  assert.equal(t.calls.length, dessins + 1, "widget remis : les lignes repartent");
  assert.equal(t.displayed.length, 2, "et elles sont bien peintes");
  assert.match(els.listCount.textContent, /^2 candidatures affichées sur 2/);
});

test("le faux Tabulator bâtit son DOM comme le vrai : la passe compte", async () => {
  // Ce que ce test protège n'est pas le faux, c'est ce qu'il refuse : un `setData`
  // (ou un `getColumn`) dans la passe qui suit la construction. C'est exactement le
  // défaut qui a été livré puis corrigé — le tableau naissait, et un setData immédiat
  // levait en laissant les lignes marquées comme envoyées.
  const fresh = new FakeTabulator("#x", { data: [{ id: "1" }] });
  assert.throws(() => fresh.setData([{ id: "2" }]), /verticalFillMode/, "un setData dans la passe de construction doit lever, comme dans la page");
  assert.throws(() => fresh.getColumn("company"), /verticalFillMode/, "et un getColumn aussi : c'est le même tableau pas encore bâti");
  await Promise.resolve();
  fresh.setData([{ id: "2" }]);
  assert.equal(fresh.calls.length, 1, "une passe plus tard, il passe");
});

test("la liste s'abonne à un widget qui existe au catalogue du plateau", async () => {
  const table = await load("table.js");
  const { WIDGETS } = await load("dashboard.js");
  const subscribed = [];

  table.bindTableWidget((id, announce) => {
    subscribed.push(id);
    announce(true);
  });

  assert.deepEqual(subscribed, ["table"], "la liste s'abonne à sa carte, et à une seule");
  assert.ok(WIDGETS.some((widget) => widget.id === "table"), "et cette carte est au catalogue : sinon l'abonnement ne se déclencherait jamais");
});
