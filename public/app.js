// Point d'entrée du front-end.
// --------------------------------------------------------------------------
// Ce fichier n'a plus qu'un rôle : assembler les modules, orchestrer le rendu
// de l'écran et brancher les raccourcis clavier globaux. Chaque écran (tableau,
// vue d'ensemble, sauvegardes, fiche candidature…) vit dans son module sous
// js/, avec ses propres vues, ses propres actions et ses propres écouteurs.
"use strict";

import { state, els } from "./js/state.js";
import { applyTheme, anyModalOpen, closeMenus, focusKeyOf, refocus, resolveConfirm, bindShell } from "./js/shell.js";
import { setRenderer } from "./js/render.js";
import { load } from "./js/api.js";
import { loadColumns, renderColumnsMenu, bindColumns } from "./js/columns.js";
import { renderPills, renderTypeFilter, renderFilterState, initFilters, bindFilters } from "./js/filters.js";
import { renderStats, renderAlert, refreshDashboard, bindOverview, bindCharts } from "./js/overview.js";
import { renderTable, bindTableWidget } from "./js/table.js";
import { initDashboard, bindDashboard, renderDashboardLayout, watchWidget } from "./js/dashboard.js";
import { openFormModal, closeFormModal, optionsFor, bindEntries } from "./js/entries.js";
import { loadCover, closeCoverModal, bindCover } from "./js/cover.js";
import { closeBackupsModal, bindBackups } from "./js/backups.js";
import { renderExportMenu, closeImportModal, bindTransfer } from "./js/transfer.js";

const { STATUSES, TYPES } = Rules;

/** Un rendu unique après une mutation d'état : jamais un écran à moitié à jour. */
function render() {
  const key = focusKeyOf(document.activeElement);
  // Le plateau range ses widgets avant que quiconque y écrive : un widget retiré
  // ou remis change ce que les autres rendus trouvent devant eux.
  renderDashboardLayout();
  renderStats();
  renderPills();
  renderTypeFilter();
  renderAlert();
  renderFilterState();
  renderTable();
  renderExportMenu();
  refreshDashboard();
  refocus(key);
}

/**
 * Raccourcis clavier globaux : ils traversent tous les écrans (Échap ferme ce
 * qui est ouvert, « n » crée une candidature, « / » va à la recherche).
 */
function bindGlobalKeys() {
  document.addEventListener("keydown", (e) => {
    const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

    if (e.key === "Escape") {
      if (state.confirmResolve) return resolveConfirm(false);
      if (!els.backupsModal.classList.contains("hidden")) return closeBackupsModal();
      if (!els.coverModal.classList.contains("hidden")) return closeCoverModal();
      if (!els.importModal.classList.contains("hidden")) return closeImportModal();
      if (!els.modal.classList.contains("hidden")) return closeFormModal();
      // Un menu ouvert se ferme, et le focus revient à son bouton.
      return closeMenus({ restoreFocus: true });
    }

    if (inField || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      if (!anyModalOpen()) openFormModal();
    } else if (e.key === "/" || e.key === "s" || e.key === "S") {
      if (anyModalOpen()) return; // ne pas voler le focus derrière une modale
      e.preventDefault();
      els.search.focus();
      els.search.select();
    }
  });
}

/**
 * Câblage entre écrans : c'est ici, et seulement ici, que deux modules qui
 * s'ignorent sont mis en relation (le bouton de thème et les graphiques, par
 * exemple, que `shell.js` ne connaît pas).
 */
function init() {
  // Le plateau ouvre le bal et s'occupe du registre des éléments : il monte les
  // widgets, remplit le registre, puis applique la disposition enregistrée. Cet
  // ordre est son affaire et il est écrit là-bas, une seule fois (`initDashboard`).
  // Rien ici ne doit lire un élément avant lui : ce que les widgets contiennent
  // n'existe pas tant qu'ils ne sont pas montés.
  initDashboard();

  // Les colonnes affichées viennent des préférences de l'utilisateur : elles
  // doivent être connues avant de construire le tableau.
  state.columns = loadColumns();
  // La sélection affichée est posée par son propriétaire, avant le premier rendu.
  initFilters();
  els.fStatus.innerHTML = optionsFor(STATUSES, "À postuler");
  els.fType.innerHTML = optionsFor(TYPES, "CDI");

  applyTheme(document.documentElement.getAttribute("data-theme") || "light");
  renderColumnsMenu();
  // Le thème change les variables CSS dont les graphiques tirent leurs couleurs :
  // l'ossature ne connaît pas les graphiques, c'est le câblage qui le lui dit.
  bindShell({ onThemeChange: refreshDashboard });
  // Le contrat de vie du plateau est passé aux écrans qui possèdent un conteneur de
  // widget : ils s'y abonnent ici, et le plateau n'a donc pas à les connaître. L'appel
  // immédiat leur donne l'état courant, donc personne ne relit le document au
  // démarrage — et le tableau se construit tout seul, au premier rendu qui verra son
  // conteneur (voir `renderTable`).
  bindCharts(watchWidget);
  bindTableWidget(watchWidget);
  bindDashboard();
  bindColumns();
  bindFilters();
  bindOverview();
  bindEntries();
  bindCover();
  bindBackups();
  bindTransfer();
  bindGlobalKeys();

  loadCover();
  load();
}

setRenderer(render);
init();
