// État partagé de la page et registre des éléments du DOM.
// --------------------------------------------------------------------------
// Un seul objet `state` : chaque écran lit et écrit ici. Personne ne garde sa
// propre copie des mêmes chiffres, sinon le même mot finit par porter deux
// valeurs selon l'endroit de l'écran qui l'a calculé.
"use strict";

export const state = {
  apps: [],
  loaded: false,
  cover: null, // page de garde du PDF (chargée depuis l'API)
  dashboard: null, // séries et analyses du serveur (ce que l'écran affiche)
  backups: [], // dernier listing d'instantanés (pour nommer celui qu'on restaure)
  columns: [], // colonnes affichées — remplies par columns.js au démarrage
  layout: null, // disposition du tableau de bord (widgets, ordre, largeurs) — tenue par dashboard.js
  editingId: null,
  confirmResolve: null,
  charts: {},
  // La sélection affichée — `filters`, `quick`, `sort`, `selectSort` — appartient à
  // filters.js, qui en déclare la forme, les défauts et les transitions. Elle est
  // posée par `initFilters()`, appelée au démarrage avant le premier rendu :
  // aucun autre module ne les écrit.
};

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Éléments du DOM mis en cache au démarrage : écouteurs et rendus les retrouvent
// par leur nom (`els.stats`, `els.modal`…) sans interroger le document à chaque
// fois. Le registre est rempli par le plateau, une fois les widgets montés — la
// recherche, le tableau et les canevas n'existent pas avant (voir `initDashboard`).
export const els = {};

export function cacheElements() {
  Object.assign(els, {
    // Le plateau du tableau de bord : ses widgets, leurs commandes et le menu qui
    // les ajoute ou les retire (voir js/dashboard.js).
    bento: $("#bento"),
    btnWidgets: $("#btn-widgets"),
    widgetsMenu: $("#widgets-menu"),
    btnLayout: $("#btn-layout"),
    resetLayout: $("#btn-layout-reset"),

    alertBar: $("#alert-bar"),
    alertText: $("#alert-text"),
    alertAction: $("#alert-action"),

    search: $("#search"),
    searchClear: $("#search-clear"),
    filterType: $("#filter-type"),
    filterStatus: $("#filter-status"),
    filterFollowup: $("#filter-followup"),
    filterDates: $(".date-filter"),
    filterDateField: $("#filter-date-field"),
    filterFrom: $("#filter-from"),
    filterTo: $("#filter-to"),
    sort: $("#sort"),
    resetFilters: $("#reset-filters"),

    btnAdd: $("#btn-add"),
    btnImport: $("#btn-import"),
    btnTheme: $("#btn-theme"),
    themeIcon: $("#theme-icon"),
    btnExportMenu: $("#btn-export-menu"),
    exportMenu: $("#export-menu"),
    exportNote: $("#export-note"),
    exportPdfHint: $("#export-pdf-hint"),
    exportCsvHint: $("#export-csv-hint"),
    btnColumns: $("#btn-columns"),
    columnsMenu: $("#columns-menu"),

    importFile: $("#import-file"),
    importModal: $("#import-modal"),
    importClose: $("#import-close"),
    importCancel: $("#import-cancel"),
    importConfirm: $("#import-confirm"),
    importFilename: $("#import-filename"),

    insightsFunnel: $("#insights-funnel"),
    insightsSources: $("#insights-sources"),
    insightsDelay: $("#insights-delay"),

    backupsModal: $("#backups-modal"),
    backupsClose: $("#backups-close"),
    backupsCancel: $("#backups-cancel"),
    backupsCreate: $("#backups-create"),
    backupsList: $("#backups-list"),
    backupsNote: $("#backups-note"),

    coverModal: $("#cover-modal"),
    coverForm: $("#cover-form"),
    coverClose: $("#cover-close"),
    coverCancel: $("#cover-cancel"),
    coverSave: $("#cover-save"),
    coverEnabled: $("#cover-enabled"),
    coverTitleInput: $("#cover-title-input"),
    coverSubtitleInput: $("#cover-subtitle-input"),
    coverTextInput: $("#cover-text-input"),
    coverTextCount: $("#cover-text-count"),
    coverStats: $("#cover-stats"),
    coverMenuHint: $("#cover-menu-hint"),
    coverPreview: $("#cover-preview"),

    confirmModal: $("#confirm-modal"),
    confirmTitle: $("#confirm-title"),
    confirmText: $("#confirm-text"),
    confirmOk: $("#confirm-ok"),
    confirmCancel: $("#confirm-cancel"),
    confirmClose: $("#confirm-close"),

    listTitle: $("#list-title"),
    listCount: $("#list-count"),
    tableWrap: $(".table-wrap"),
    applicationsTable: $("#applications-table"),
    skeleton: $("#skeleton"),
    empty: $("#empty"),
    emptyTitle: $("#empty-title"),
    emptyText: $("#empty-text"),
    emptyAction: $("#empty-action"),

    modal: $("#modal"),
    modalTitle: $("#modal-title"),
    modalSub: $("#modal-sub"),
    modalClose: $("#modal-close"),
    form: $("#form"),
    formError: $("#form-error"),
    btnSave: $("#btn-save"),
    btnCancel: $("#btn-cancel"),
    btnDelete: $("#btn-delete"),
    historyBox: $("#history-box"),
    historyList: $("#history-list"),
    dupHint: $("#dup-hint"),

    fCompany: $("#f-company"),
    fPosition: $("#f-position"),
    fStatus: $("#f-status"),
    fType: $("#f-type"),
    fDateDemarche: $("#f-dateDemarche"),
    fNextAction: $("#f-nextAction"),
    fPostalCode: $("#f-postalCode"),
    fLocation: $("#f-location"),
    fSource: $("#f-source"),
    fSalary: $("#f-salary"),
    fUrl: $("#f-url"),
    fContactName: $("#f-contactName"),
    fContactPhone: $("#f-contactPhone"),
    fContactEmail: $("#f-contactEmail"),
    fNotes: $("#f-notes"),

    toasts: $("#toasts"),
  });
}
