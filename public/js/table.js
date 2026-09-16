// Tableau des candidatures : construction Tabulator, contenu des cellules,
// édition inline, titre et compteur de la liste. L'ordre affiché appartient à
// filters.js (état de la sélection) : un clic d'en-tête lui demande le tri.
"use strict";

import { state, els } from "./state.js";
import { escapeHtml, icon, showEmpty, relativeDay, statusBadge, typeBadge, followUpReason, telHref, toast } from "./ui.js";
import { api, fetchDashboard } from "./api.js";
import { COLUMNS } from "./columns.js";
import { openFormModal, deleteApplication } from "./entries.js";
import { visibleApps, resetFilters, sortByColumn } from "./filters.js";
import { scheduleRender } from "./render.js";

const { dateRangeLabel, fmtDateFR, lastMoveAt, lastStatus, followUpState, daysSinceActivity: daysSince } = Rules;

/** Contenu brut d'une cellule (sans l'enveloppe `.cell-value`) */
function cellContent(app, field) {
  switch (field) {
    case "company": {
      // Colonne « Notes » masquée : un repère discret signale que la fiche a une note
      // (infobulle + contenu lu par les lecteurs d'écran).
      const noteFlag =
        app.notes && !state.columns.includes("notes")
          ? ` <span class="note-flag" title="${escapeHtml(app.notes)}">${icon("note", "ico-xs")}<span class="sr-only"> Note jointe : ${escapeHtml(app.notes)}</span></span>`
          : "";
      return escapeHtml(app.company || "—") + noteFlag;
    }
    case "position":
      return escapeHtml(app.position || "—");
    case "status":
      return `<button type="button" class="badge-button" title="Changer le statut">${statusBadge(app.status)}</button>`;
    case "type":
      return typeBadge(app.type);
    case "dateDemarche":
      return app.dateDemarche ? fmtDateFR(app.dateDemarche) : '<span class="muted">—</span>';
    case "nextAction": {
      const st = followUpState(app);
      if (!app.nextAction && !st) return '<span class="muted">—</span>';
      const chips = [];
      if (app.nextAction) {
        chips.push(`<span class="na-date" title="Relance planifiée">${fmtDateFR(app.nextAction)}</span>`);
      }
      if (st === "due") chips.push('<span class="badge warn" title="La date de relance est atteinte">à faire</span>');
      else if (st === "overdue") {
        chips.push(`<span class="badge danger" title="${escapeHtml(followUpReason(app))}">+${daysSince(app)} j</span>`);
      }
      return chips.join(" ");
    }
    case "lastMove": {
      const at = lastMoveAt(app);
      if (!at) return '<span class="muted">—</span>';
      const iso = new Date(at).toISOString();
      const status = lastStatus(app);
      return `<span class="move-ago">${escapeHtml(relativeDay(iso))}</span>${
        status ? ` <span class="muted small">${escapeHtml(status)}</span>` : ""
      }`;
    }
    case "contact": {
      const lines = [];
      if (app.contactName) lines.push(`<span class="contact-line contact-name">${escapeHtml(app.contactName)}</span>`);
      if (app.contactPhone) {
        const href = telHref(app.contactPhone);
        lines.push(
          `<span class="contact-line contact-tel">${
            href ? `<a href="${escapeHtml(href)}">${escapeHtml(app.contactPhone)}</a>` : escapeHtml(app.contactPhone)
          }</span>`
        );
      }
      if (app.contactEmail) {
        lines.push(`<span class="contact-line contact-mail"><a href="mailto:${escapeHtml(app.contactEmail)}">${escapeHtml(app.contactEmail)}</a></span>`);
      }
      return lines.length ? lines.join("") : '<span class="muted">—</span>';
    }
    case "url":
      return app.url
        ? `<a href="${escapeHtml(app.url)}" target="_blank" rel="noopener noreferrer">Ouvrir l'offre ↗</a>`
        : '<span class="muted">—</span>';
    case "notes":
      return app.notes
        ? `<span class="notes-preview" title="${escapeHtml(app.notes)}">
             <span class="notes-icon" aria-hidden="true">${icon("note", "ico-xs")}</span>
             <span class="notes-text">${escapeHtml(app.notes)}</span>
           </span>`
        : '<span class="muted">—</span>';
    default:
      return escapeHtml(app[field] ?? "") || '<span class="muted">—</span>';
  }
}

/**
 * Contenu d'une cellule, toujours enveloppé dans UN élément.
 * Indispensable pour la vue « cartes » : la cellule est une grille
 * (libellé + valeur) et chaque enfant deviendrait sinon une case,
 * ce qui décalait la 2ᵉ ligne du contact dans la colonne du libellé.
 */
function cellDisplay(app, field) {
  return `<span class="cell-value">${cellContent(app, field)}</span>`;
}

function selectEditor(values) {
  return (cell, onRendered, success, cancel) => {
    const select = document.createElement("select");
    const current = String(cell.getValue() ?? "");
    const options = current && !values.includes(current) ? [...values, current] : values;
    select.className = "cell-input";
    select.innerHTML = options
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      .join("");
    select.value = current;

    let finished = false;
    const commit = () => {
      if (finished) return;
      finished = true;
      success(select.value);
    };
    const abort = () => {
      if (finished) return;
      finished = true;
      cancel();
    };
    select.addEventListener("change", commit);
    select.addEventListener("blur", commit);
    select.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        abort();
      } else if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    });
    onRendered(() => {
      select.focus();
      select.select?.();
    });
    return select;
  };
}

function editorForColumn(column) {
  if (column.readonly) return false;
  if (column.field === "status") return selectEditor(Rules.STATUSES);
  if (column.field === "type") return selectEditor(Rules.TYPES);
  if (column.field === "dateDemarche" || column.field === "nextAction") return "date";
  if (column.field === "notes") return "textarea";
  return "input";
}

async function persistCellEdit(cell, field) {
  const row = cell.getRow().getData();
  const value = cell.getValue();
  const payload = { [field === "contact" ? "contactName" : field]: value };
  const oldValue = typeof cell.getOldValue === "function" ? cell.getOldValue() : value;

  try {
    const updated = await api(`/api/applications/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const index = state.apps.findIndex((app) => app.id === row.id);
    if (index >= 0) state.apps[index] = updated;
    toast("Candidature mise à jour.", { type: "ok", timeout: 2600 });
    // Les graphiques et les analyses ont bougé eux aussi : on les redemande
    // plutôt que de laisser l'écran montrer deux états différents à la fois.
    await fetchDashboard();
    scheduleRender();
  } catch (error) {
    if (typeof cell.restoreOldValue === "function") cell.restoreOldValue();
    else cell.setValue(oldValue, true);
    toast(`Modification impossible : ${error.message}`, { type: "error" });
    scheduleRender();
  }
}

function tabulatorColumn(column) {
  const editable = !column.readonly;
  return {
    title: column.label,
    field: column.field,
    headerTooltip: column.label, // l'option s'appelle `headerTooltip` (Tabulator 6) : `titleTooltip` est ignorée, et bruyante
    cssClass: column.cls || "",
    visible: state.columns.includes(column.field),
    headerSort: false,
    headerClick: () => column.sortable && sortByColumn(column.field),
    formatter: (cell) => cellDisplay(cell.getData(), column.field),
    ...(editable
      ? {
        editor: editorForColumn(column),
        cellEdited: (cell) => persistCellEdit(cell, column.field),
      }
      : {}),
  };
}

/** L'id du widget qui porte la liste, au catalogue du plateau (js/dashboard.js). */
const WIDGET = "table";

/**
 * Le conteneur du tableau est-il dans le document ? C'est ce que le plateau a
 * annoncé (voir `bindTableWidget`), jamais une inspection du document.
 */
let tableInPage = false;

let applicationsTable = null;

/**
 * Construit le tableau — une seule fois, et seulement quand le plateau a annoncé
 * que son conteneur est dans le document (`bindTableWidget`). C'est `renderTable`
 * qui l'appelle, à chaque rendu : c'est lui qui tire le cycle de vie du widget, et
 * lui seul décide donc de le construire. Le widget « Toutes les candidatures » peut
 * revenir dans la page à tout moment — remis par le menu, par « Réinitialiser », ou
 * présent dès le démarrage — sans que le plateau ait à connaître l'existence de
 * cette fonction.
 *
 * Un conteneur hors du document ne se construit pas : le widget retiré n'est plus
 * dans la page, il n'y a rien à y monter. Et un tableau déjà construit n'est jamais
 * reconstruit : Tabulator n'a rien à refaire pour le même conteneur.
 *
 * Les lignes arrivent AVEC la construction (`data`) et non par un `setData` juste
 * après : le tableau n'est pas prêt dans la passe qui suit sa construction — c'est
 * Tabulator qui le dit (« Table Not Initialized - Calling the setData function
 * before the table is initialized may result in inconsistent behavior »), et dans
 * cette page la passe a levé (`Cannot read properties of null (reading
 * 'verticalFillMode')`) en laissant les lignes marquées comme envoyées, donc sans
 * repeinture possible ensuite. Passer les lignes au constructeur est le chemin que
 * Tabulator recommande pour les données initiales.
 *
 * Renvoie le tableau s'il vient d'être construit (ses lignes sont déjà dedans),
 * `null` sinon.
 */
export function initTable(rows = []) {
  if (typeof Tabulator === "undefined" || applicationsTable) return null;
  if (!tableInPage) return null;
  applicationsTable = new Tabulator("#applications-table", {
    data: rows,
    layout: "fitDataStretch",
    editTriggerEvent: "click",
    responsiveLayout: "collapse",
    responsiveLayoutCollapseStartOpen: false,
    pagination: true,
    paginationMode: "local",
    paginationSize: 15,
    paginationSizeSelector: [10, 15, 25, 50],
    movableColumns: true,
    resizableColumns: true,
    placeholder: "Aucune candidature pour le moment",
    rowFormatter: (row) => {
      const app = row.getData();
      row.getElement().classList.toggle("needs-followup", Boolean(followUpState(app)));
    },
    columns: [...COLUMNS.map(tabulatorColumn), {
      title: "Actions",
      field: "_actions",
      headerSort: false,
      responsive: false,
      hozAlign: "right",
      width: 82,
      formatter: () => `<button class="icon-btn" type="button" data-action="edit" aria-label="Modifier" title="Modifier">${icon("pencil", "ico-sm")}</button><button class="icon-btn danger" type="button" data-action="delete" aria-label="Supprimer" title="Supprimer">${icon("trash", "ico-sm")}</button>`,
      cellClick: (event, cell) => {
        const app = cell.getRow().getData();
        if (event.target.closest("[data-action=edit]")) openFormModal(app);
        if (event.target.closest("[data-action=delete]")) deleteApplication(app);
      },
    }],
  });
  return applicationsTable;
}

function syncTableColumns() {
  if (!applicationsTable) return;
  for (const column of COLUMNS) {
    const component = applicationsTable.getColumn(column.field);
    if (!component) continue;
    if (state.columns.includes(column.field)) component.show();
    else component.hide();
  }
}

function rowsForTable(list) {
  return list.map((app) => ({ ...app, contact: app.contactName || "" }));
}

/**
 * Ce qui a déjà été dessiné dans le tableau, sous forme de clé compacte.
 *
 * `setData` reconstruit tout le tableau : mesuré sur la page, un rendu coûte ~41 ms
 * dont ~40 ms dans cet appel, qui relit la mise en page 563 fois (lectures de
 * `offsetHeight`) pour 12 lignes. Certains rendus ne changent pourtant aucune ligne —
 * basculer une colonne autre que « Notes », recharger un jeu identique : les rejouer
 * coûte 40 ms et ramène au passage le tableau à la page 1.
 *
 * La clé doit couvrir TOUT ce dont le contenu d'une cellule dépend, et pas seulement
 * les données de la ligne. `cellContent` lit trois choses, les voilà toutes :
 * — la ligne elle-même ;
 * — `state.columns` : la cellule « Entreprise » porte un repère de note quand la
 *   colonne « Notes » est masquée (sans ce drapeau, basculer « Notes » laisserait
 *   les repères en place — vérifié) ; les autres colonnes
 *   ne changent que leur visibilité, pas le contenu ;
 * — le jour courant : « il y a 3 j » et l'état de relance sont calculés à l'affichage,
 *   donc un écran laissé ouvert toute la nuit se rafraîchit au premier rendu du
 *   lendemain au lieu de garder la date de la veille.
 */
let drawnRows = null;

/** La clé de ce qui est affiché : les lignes, le jour courant, et la colonne « Notes » (voir ci-dessus). */
function rowsSignature(rows) {
  return [state.columns.includes("notes") ? "1" : "0", new Date().toDateString(), JSON.stringify(rows)].join("|");
}

function tableContentChanged(rows) {
  const key = rowsSignature(rows);
  if (key === drawnRows) return false;
  drawnRows = key;
  return true;
}

/**
 * S'abonner à la vie de la carte « Toutes les candidatures » : le plateau est seul
 * à savoir quand une carte entre dans le document ou en sort (js/dashboard.js), et
 * il l'annonce. On retient où en est le conteneur — c'est la seule chose que
 * `initTable` et `renderTable` consultent, et rien ici ne relit le document pour
 * deviner si le widget est encore affiché.
 *
 * L'abonnement est posé par app.js : le plateau ne connaît aucun écran, et cette
 * fonction n'appelle personne.
 */
export function bindTableWidget(watch) {
  watch(WIDGET, (inBoard) => {
    tableInPage = inBoard;
    // Les lignes ne sont plus à l'écran : on oublie ce qui a été dessiné, pour que
    // le premier rendu qui verra le conteneur revenu repeigne vraiment.
    if (!inBoard) drawnRows = null;
  });
}

export function renderTable() {
  const list = visibleApps();
  const total = state.apps.length;
  const rows = rowsForTable(list);

  // La visibilité du conteneur est posée AVANT le rafraîchissement, jamais après.
  // `setData` ne peint rien dans un tableau qui n'a pas de dimensions : masqué
  // (`display: none`), `#applications-table` mesure 0 px de haut, les lignes ne sont
  // pas dessinées — et réafficher le conteneur ensuite ne les redessine pas
  // (mesuré). Le rafraîchissement doit donc trouver le conteneur dans son état
  // définitif, sinon les lignes existent, le compteur les annonce, et l'écran reste
  // vide jusqu'au prochain rendu qui change vraiment la liste. C'est le cas de
  // chaque sortie de l'état vide : première candidature, import,
  // restauration, réinitialisation des filtres.
  els.tableWrap.classList.toggle("hidden", list.length === 0);

  // Le conteneur est dans la page : le tableau doit exister. C'est ici, et seulement
  // ici, que le cycle de vie du widget est tiré — un widget peut revenir à n'importe
  // quel rendu (menu « Widgets », « Réinitialiser »). Les rendus pendant lesquels il
  // était absent n'ont rien construit ; celui qui le voit revenu le construit, avec
  // les lignes de cette sélection (voir `initTable`).
  const built = initTable(rows);

  if (!tableInPage) {
    // Widget retiré du tableau de bord : le plateau l'a annoncé (`bindTableWidget`),
    // et le conteneur est hors du document, où il mesure 0 px — même piège que le
    // conteneur masqué ci-dessus, en plus radical. On oublie ce qui a été dessiné,
    // pour que le premier rendu qui le verra revenu repeigne vraiment ses lignes.
    drawnRows = null;
  } else if (built) {
    // Né à l'instant avec ses lignes : rien à leur envoyer, et rien à synchroniser —
    // les colonnes affichées sont déjà celles du constructeur (voir `tabulatorColumn`).
    // On retient seulement ce qui est dessiné, pour ne pas le renvoyer ensuite.
    drawnRows = rowsSignature(rows);
  } else if (applicationsTable) {
    syncTableColumns();
    if (tableContentChanged(rows)) applicationsTable.setData(rows);
  }
  const plural = list.length > 1 ? "s" : "";
  const sortLabel = state.sort.key ? `triées par ${COLUMNS.find((c) => c.field === state.sort.key)?.label} ${state.sort.dir === "asc" ? "croissant" : "décroissant"}` : "";
  els.listCount.textContent = total === 0 ? "" : `${list.length} candidature${plural} affichée${plural} sur ${total}${sortLabel ? ` · ${sortLabel}` : ""}`;
  if (state.filters.status) els.listTitle.textContent = `Candidatures — ${state.filters.status}`;
  else if (state.filters.from || state.filters.to) els.listTitle.textContent = `Candidatures ${dateRangeLabel(state.filters.from, state.filters.to, state.filters.dateField)}`;
  else if (state.quick === "followup" || state.filters.followup) els.listTitle.textContent = "Candidatures à relancer";
  else if (state.quick === "sent") els.listTitle.textContent = "Candidatures envoyées";
  else if (state.quick === "interview") els.listTitle.textContent = "Entretiens et offres";
  else if (state.quick === "refused") els.listTitle.textContent = "Candidatures refusées";
  else if (state.filters.q) els.listTitle.textContent = `Résultats pour « ${state.filters.q} »`;
  else els.listTitle.textContent = "Toutes les candidatures";
  if (total === 0) showEmpty({ title: "Aucune candidature pour le moment", text: "Ajoutez votre première candidature pour démarrer le suivi.", action: "Nouvelle candidature", onAction: () => openFormModal() });
  else if (list.length === 0) showEmpty({ title: "Aucun résultat", text: "Aucune candidature ne correspond à ces filtres.", action: "Réinitialiser les filtres", actionIcon: "sliders", onAction: resetFilters });
  else els.empty.classList.add("hidden");
}
