// Les graphiques de la vue d'ensemble ne doivent être (re)dessinés que lorsque
// leur source change : une nouvelle réponse du serveur, ou un changement de thème
// (les couleurs viennent des jetons CSS). `render()` tourne à chaque frappe dans la
// recherche : détruire et recréer les trois graphiques à chaque fois coûtait 10 ms
// par rendu pour rien, mesuré sur la page (46 ms avec, 36 ms sans).
//
// Ces tests importent overview.js hors navigateur, avec un DOM et un Chart.js
// minimaux : ce qui est vérifié, c'est le nombre de graphiques construits, pas leur
// dessin.
"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const assert = require("node:assert/strict");

const PUBLIC_JS = path.join(__dirname, "..", "public", "js");

// lib/rules.js est le module dual : en le require() il s'expose aussi en global,
// ce dont ui.js et overview.js ont besoin (STATUS_TONE, fmtDateFR…).
globalThis.Rules = require(path.join(__dirname, "..", "lib", "rules.js"));

// --- DOM minimal ----------------------------------------------------------
const canvases = new Map();
globalThis.document = {
  documentElement: { getAttribute: () => "light" },
  querySelector(selector) {
    if (!canvases.has(selector)) canvases.set(selector, { id: selector });
    return canvases.get(selector);
  },
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" }); // → couleurs de repli

class FakeChart {
  constructor(element, config) {
    FakeChart.created.push({ element, config });
    this.config = config;
  }
  destroy() {
    FakeChart.destroyed += 1;
  }
}
FakeChart.created = [];
FakeChart.destroyed = 0;
FakeChart.reset = () => { FakeChart.created = []; FakeChart.destroyed = 0; };
globalThis.Chart = FakeChart;

const load = (file) => import(pathToFileURL(path.join(PUBLIC_JS, file)).href);

const payload = (total) => ({
  monthly: [{ label: "sept.", value: total }],
  byStatus: [{ label: "Postulé", value: total }],
  byType: [{ label: "CDI", value: total }],
  insights: { sources: [], responseDelay: { count: 0, average: 0 }, funnel: [{ label: "Envoyées", value: total }] },
});

test("les graphiques ne sont pas redessinés tant que leur source ne change pas", async () => {
  const overview = await load("overview.js");
  const { state } = await load("state.js");

  // Le plateau est seul à savoir si une carte est dans le document, et il l'annonce :
  // ici, les trois sont affichées (voir bindCharts dans overview.js).
  overview.bindCharts((id, announce) => announce(true));
  FakeChart.reset();
  state.charts = {};

  state.dashboard = payload(3);
  overview.refreshDashboard();
  assert.equal(FakeChart.created.length, 3, "les trois graphiques doivent être dessinés au premier rendu");

  // Même réponse, même thème : c'est le cas d'un filtre, d'une recherche ou d'un
  // tri — rien de ce que les graphiques montrent n'a bougé.
  overview.refreshDashboard();
  overview.refreshDashboard();
  assert.equal(FakeChart.created.length, 3, "un rendu de liste ne doit pas reconstruire les graphiques");
  assert.equal(FakeChart.destroyed, 0, "et ne doit pas les détruire");

  // Nouvelle réponse du serveur : là, il faut redessiner.
  state.dashboard = payload(4);
  overview.refreshDashboard();
  assert.equal(FakeChart.created.length, 6, "une nouvelle réponse doit redessiner les trois graphiques");

  // Changement de thème : les couleurs viennent des jetons CSS, donc on redessine
  // même si la réponse est la même.
  const theme = globalThis.document.documentElement.getAttribute;
  globalThis.document.documentElement.getAttribute = () => "dark";
  overview.refreshDashboard();
  globalThis.document.documentElement.getAttribute = theme;
  assert.equal(FakeChart.created.length, 9, "un changement de thème doit redessiner les graphiques");
});

test("un graphique dont la carte sort du document est détruit, et redessiné quand elle revient", async () => {
  const overview = await load("overview.js");
  const { state } = await load("state.js");
  const announce = new Map();
  overview.bindCharts((id, onChange) => announce.set(id, onChange));

  FakeChart.reset();
  state.charts = {};
  state.dashboard = payload(3);
  for (const onChange of announce.values()) onChange(true);
  overview.refreshDashboard();
  assert.equal(FakeChart.created.length, 3, "trois cartes affichées : trois graphiques");

  // Le widget « Répartition par statut » est retiré du tableau de bord : le plateau
  // l'annonce, et son graphique est détruit — le canevas est hors du document, où il
  // mesure 0 px.
  announce.get("chart-status")(false);
  overview.refreshDashboard();
  assert.equal(state.charts.byStatus, undefined, "le graphique de la carte retirée est détruit");
  assert.ok(state.charts.monthly && state.charts.byType, "les autres cartes gardent le leur");

  // Il revient : le rendu qui l'apprend le redessine.
  announce.get("chart-status")(true);
  overview.refreshDashboard();
  assert.ok(state.charts.byStatus, "la carte revenue est redessinée");
});

test("les graphiques s'abonnent à des widgets qui existent au catalogue du plateau", async () => {
  const overview = await load("overview.js");
  const { WIDGETS } = await load("dashboard.js");
  const subscribed = [];
  overview.bindCharts((id) => subscribed.push(id));

  assert.equal(subscribed.length, 3, "trois cartes de graphique, trois abonnements");
  for (const id of subscribed) {
    assert.ok(WIDGETS.some((widget) => widget.id === id), `« ${id} » n'est pas au catalogue : son abonnement ne se déclencherait jamais`);
  }
});
