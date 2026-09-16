// Colonnes du tableau : définition, préférences de l'utilisateur (localStorage)
// et menu « Colonnes ».
"use strict";

import { state, els } from "./state.js";
import { escapeHtml, toast } from "./ui.js";
import { toggleMenu } from "./shell.js";
import { scheduleRender } from "./render.js";

// Colonnes du tableau / des cartes (ordre d'affichage)
export const COLUMNS = [
  { field: "company", label: "Entreprise", cls: "cell-company", width: "16%", sortable: true },
  { field: "position", label: "Poste", width: "18%", sortable: true },
  { field: "status", label: "Statut", sortable: true },
  { field: "type", label: "Type", sortable: true },
  { field: "nextAction", label: "Relance", cls: "cell-followup", sortable: true },
  { field: "dateDemarche", label: "Démarche", cls: "cell-date", sortable: true },
  { field: "lastMove", label: "Dernier mouvement", cls: "cell-date", off: true, sortable: true, readonly: true },
  { field: "location", label: "Lieu", sortable: true },
  { field: "contact", label: "Contact", cls: "cell-contact", sortable: true },
  // Le téléphone est affiché d'origine : c'est une info de contact aussi utile
  // que le nom, et elle est déjà exportée en CSV et en PDF.
  { field: "contactPhone", label: "Téléphone", sortable: true },
  { field: "postalCode", label: "Code postal", cls: "cell-date", off: true, sortable: true },
  { field: "source", label: "Source", off: true, sortable: true },
  { field: "salary", label: "Salaire", off: true, sortable: true },
  { field: "url", label: "Lien", cls: "cell-url", off: true, sortable: true },
  // Les notes sont affichées d'origine : c'est souvent l'information la plus utile,
  // et personne ne pense à aller la chercher dans « Colonnes ».
  { field: "notes", label: "Notes", cls: "cell-notes", sortable: true },
];

const COLUMNS_KEY = "jt-columns";
// Version des préférences de colonnes : elle sert à appliquer une nouvelle
// colonne affichée par défaut aux navigateurs qui ont déjà des préférences
// enregistrées (v1 = tableau nu, v2 = « Notes », v3 = « Téléphone »).
const COLUMNS_VERSION = 3;

function defaultColumns() {
  return COLUMNS.filter((c) => !c.off).map((c) => c.field);
}

/** Colonnes affichées au démarrage : préférences enregistrées, complétées des colonnes arrivées depuis. */
export function loadColumns() {
  let stored = null;
  try {
    const raw = localStorage.getItem(COLUMNS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed && parsed.columns;
      const valid = Array.isArray(list) ? list.filter((f) => COLUMNS.some((c) => c.field === f)) : [];
      if (valid.length) {
        stored = { version: Array.isArray(parsed) ? 1 : Number(parsed.v) || 1, columns: valid };
      }
    }
  } catch { /* préférences illisibles : on repart des colonnes par défaut */ }
  if (!stored) return defaultColumns();
  // Colonnes apparues depuis que ces préférences ont été enregistrées : on les ajoute
  // à la suite (v2 = « Notes », v3 = « Téléphone »). Celles que l'utilisateur a
  // masquées volontairement depuis ne sont pas touchées : c'est `COLUMNS_VERSION`
  // qui décide, pas l'ordre des versions.
  if (stored.version < COLUMNS_VERSION) {
    const arrivees = ["notes", "contactPhone"];
    stored.columns = [...stored.columns, ...arrivees.filter((f) => !stored.columns.includes(f))];
  }
  return stored.columns;
}

function saveColumns() {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify({ v: COLUMNS_VERSION, columns: state.columns }));
  } catch { /* ignore */ }
}

export function renderColumnsMenu() {
  els.columnsMenu.innerHTML = COLUMNS.map(
    (c) => `<label>
      <input type="checkbox" data-col="${c.field}" ${state.columns.includes(c.field) ? "checked" : ""} />
      ${escapeHtml(c.label)}
    </label>`
  ).join("");
}

export function bindColumns() {
  els.btnColumns.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu(els.btnColumns, els.columnsMenu);
  });
  els.columnsMenu.addEventListener("change", (e) => {
    const field = e.target.dataset.col;
    if (!field) return;
    if (e.target.checked) {
      state.columns = COLUMNS.filter((c) => state.columns.includes(c.field) || c.field === field).map((c) => c.field);
    } else {
      if (state.columns.length <= 1) {
        e.target.checked = true;
        toast("Gardez au moins une colonne affichée.", { type: "warn" });
        return;
      }
      state.columns = state.columns.filter((f) => f !== field);
    }
    saveColumns();
    scheduleRender();
  });
}
