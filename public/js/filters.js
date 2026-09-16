// Recherche et filtres : pastilles de statut, filtre « type », plage de dates,
// carte active et tri.
// --------------------------------------------------------------------------
// Ce module est le SEUL propriétaire de la sélection affichée — `state.filters`,
// `state.quick`, `state.sort` et `state.selectSort` — c'est-à-dire de la liste que
// l'écran montre et que les exports rejouent côté serveur (`selectApps` de
// lib/rules.js). Aucun autre module n'écrit ces champs : les cartes de statistiques
// et les en-têtes de colonnes passent par les actions définies ici.
"use strict";

import { state, els } from "./state.js";
import { escapeHtml } from "./ui.js";
import { scheduleRender } from "./render.js";

const { STATUSES, TYPES, STATUS_TONE, SORT_FIELDS, selectApps } = Rules;

/** Champ de date par défaut de la plage : écrit une fois, pour la forme et la remise à zéro. */
const DEFAULT_DATE_FIELD = "dateDemarche";

/** Forme de la sélection affichée — le seul endroit où elle est décrite. */
function emptyFilters() {
  return { q: "", status: "", type: "", followup: false, from: "", to: "", dateField: DEFAULT_DATE_FIELD };
}

/**
 * Pose la sélection de départ. Appelée par app.js au démarrage, avant le premier
 * rendu : c'est ici, et nulle part ailleurs, que ces quatre champs prennent leur
 * valeur initiale.
 */
export function initFilters() {
  state.filters = emptyFilters();
  state.quick = "";
  state.sort = { key: "", dir: "asc" };
  state.selectSort = "date-desc";
}

/**
 * Clic sur une carte de statistiques : recliquer la carte active la retire.
 * La carte « À relancer » décoche la pastille du même nom — les deux commandent la
 * même sélection, l'écran ne doit pas en montrer deux.
 */
export function setQuick(quick) {
  state.quick = quick && state.quick !== quick ? quick : "";
  if (state.quick === "followup") els.filterFollowup.checked = false;
  scheduleRender();
}

/** Bandeau d'alerte : il bascule le filtre « à relancer », comme la pastille. */
export function toggleFollowUp() {
  state.quick = state.quick === "followup" ? "" : "followup";
  state.filters.followup = false;
  els.filterFollowup.checked = false;
  scheduleRender();
}

/** Tri par clic sur un en-tête : il prend le pas sur le tri choisi dans le menu. */
export function sortByColumn(field) {
  if (!SORT_FIELDS.includes(field)) return;
  state.sort = state.sort.key === field
    ? { key: field, dir: state.sort.dir === "asc" ? "desc" : "asc" }
    : { key: field, dir: "asc" };
  state.selectSort = "";
  scheduleRender();
}

export function renderPills() {
  const counts = state.apps.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

  const pills = [
    `<button class="pill" type="button" data-status="" aria-pressed="${state.filters.status === ""}">
       Toutes <span class="count">${state.apps.length}</span>
     </button>`,
    ...STATUSES.map((s) => `
      <button class="pill" type="button" data-status="${escapeHtml(s)}" aria-pressed="${state.filters.status === s}">
        <span class="dot" style="color: var(--${STATUS_TONE[s] || "neutral"})" aria-hidden="true"></span>
        ${escapeHtml(s)} <span class="count">${counts[s] || 0}</span>
      </button>`),
  ];
  els.filterStatus.innerHTML = pills.join("");
}

/**
 * Options du filtre « type » : les types connus + ceux présents dans les données
 * (valeurs libres arrivées par import), en gardant la sélection en cours.
 * La liste n'est reconstruite que si elle change, pour ne pas refermer le menu
 * pendant que l'utilisateur l'a ouvert.
 */
export function renderTypeFilter() {
  const values = [...TYPES];
  for (const a of state.apps) {
    if (a.type && !values.includes(a.type)) values.push(a.type);
  }
  const signature = values.join("|");
  if (els.filterType.dataset.signature !== signature) {
    els.filterType.dataset.signature = signature;
    els.filterType.innerHTML =
      '<option value="">Tous les types</option>' +
      values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  }
  els.filterType.value = state.filters.type;
}

export function hasActiveFilters() {
  const f = state.filters;
  return Boolean(f.q || f.status || f.type || f.followup || f.from || f.to || state.quick);
}

export function renderFilterState() {
  els.searchClear.classList.toggle("hidden", !state.filters.q);
  els.resetFilters.classList.toggle("hidden", !hasActiveFilters());
  // La plage de dates se met en valeur dès qu'une borne est posée
  els.filterDates.classList.toggle("active", Boolean(state.filters.from || state.filters.to));
}

export function resetFilters() {
  state.filters = emptyFilters();
  state.quick = "";
  els.search.value = "";
  els.filterType.value = "";
  els.filterFollowup.checked = false;
  els.filterDateField.value = DEFAULT_DATE_FIELD;
  els.filterFrom.value = "";
  els.filterTo.value = "";
  scheduleRender();
}

/**
 * Paramètres de la sélection affichée, tels qu'envoyés aux exports. C'est le même
 * vocabulaire que l'API (`status`, `type`, `q`, `followup`, `quick`, `sort`…), donc
 * le serveur rejoue exactement la même liste que l'écran avec lib/rules.js.
 */
export function selectionParams() {
  const f = state.filters;
  return {
    q: f.q,
    status: f.status,
    type: f.type,
    followup: f.followup ? "1" : "",
    quick: state.quick,
    // Plage de dates (bornes incluses) et champ sur lequel elle porte
    from: f.from,
    to: f.to,
    dateField: f.dateField,
    // L'ordre du tableau part dans l'export : « ce que je vois » inclut l'ordre.
    // `dir` ne sert qu'avec une colonne triée (sinon `selectSort` décide).
    sort: state.sort.key,
    dir: state.sort.key ? state.sort.dir : "",
    selectSort: state.selectSort,
  };
}

export function visibleApps() {
  return selectApps(state.apps, selectionParams());
}

export function bindFilters() {
  let searchTimer = null;
  els.search.addEventListener("input", () => {
    state.filters.q = els.search.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      scheduleRender();
    }, 140);
  });
  els.searchClear.addEventListener("click", () => {
    els.search.value = "";
    state.filters.q = "";
    els.search.focus();
    scheduleRender();
  });
  els.filterType.addEventListener("change", () => {
    state.filters.type = els.filterType.value;
    scheduleRender();
  });
  els.filterFollowup.addEventListener("change", () => {
    state.filters.followup = els.filterFollowup.checked;
    if (els.filterFollowup.checked) state.quick = "";
    scheduleRender();
  });
  // Plage de dates : deux bornes facultatives, incluses, sur la démarche ou la relance
  els.filterDateField.addEventListener("change", () => {
    state.filters.dateField = els.filterDateField.value;
    scheduleRender();
  });
  els.filterFrom.addEventListener("change", () => {
    state.filters.from = els.filterFrom.value;
    scheduleRender();
  });
  els.filterTo.addEventListener("change", () => {
    state.filters.to = els.filterTo.value;
    scheduleRender();
  });
  els.filterStatus.addEventListener("click", (e) => {
    const pill = e.target.closest("[data-status]");
    if (!pill) return;
    state.filters.status = pill.dataset.status;
    scheduleRender();
  });
  els.sort.addEventListener("change", () => {
    state.selectSort = els.sort.value;
    state.sort = { key: "", dir: "asc" };
    scheduleRender();
  });
  els.resetFilters.addEventListener("click", resetFilters);
}
