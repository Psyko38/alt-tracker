// Entrées et sorties de données : import JSON, exports JSON / PDF / CSV, et le
// menu qui les propose (page de garde et sauvegardes comprises).
"use strict";

import { state, els } from "./state.js";
import { toast } from "./ui.js";
import { api, load } from "./api.js";
import { openOverlay, closeOverlay, closeMenus, toggleMenu, bindDialog } from "./shell.js";
import { openCoverModal } from "./cover.js";
import { openBackupsModal } from "./backups.js";
import { closeFormModal } from "./entries.js";
import { visibleApps, hasActiveFilters, selectionParams } from "./filters.js";

// `scoped: true` = l'export suit la sélection affichée (filtres, recherche, tri).
// La sauvegarde JSON reste volontairement complète : une sauvegarde partielle ne
// doit pas pouvoir écraser le reste des données à la restauration.
const EXPORTS = {
  json: { url: "/api/export", label: "Sauvegarde JSON", scoped: false },
  pdf: { url: "/api/export/pdf", label: "Tableau PDF", scoped: true },
  csv: { url: "/api/export/csv", label: "Tableau CSV", scoped: true },
};

/* ==========================================================================
   Import
   ========================================================================== */

let importFile = null;

export function openImportModal(file) {
  importFile = file;
  els.importFilename.textContent = file.name;
  if (!els.modal.classList.contains("hidden")) closeFormModal();
  openOverlay(els.importModal, "#import-confirm");
}

export function closeImportModal() {
  closeOverlay(els.importModal);
  els.importFile.value = "";
  importFile = null;
}

async function confirmImport() {
  if (!importFile) return closeImportModal();
  const mode = document.querySelector('input[name="import-mode"]:checked').value;

  let text;
  try {
    text = await importFile.text();
    JSON.parse(text);
  } catch {
    toast("Ce fichier n'est pas un JSON valide.", { type: "error" });
    return;
  }

  els.importConfirm.disabled = true;
  try {
    const summary = await api(`/api/import?mode=${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
    });
    const parts = [`${summary.added} candidature${summary.added > 1 ? "s" : ""} ajoutée${summary.added > 1 ? "s" : ""}`];
    if (summary.skipped) parts.push(`${summary.skipped} doublon${summary.skipped > 1 ? "s" : ""} ignoré${summary.skipped > 1 ? "s" : ""}`);
    // La sauvegarde embarque la page de garde du PDF : on le dit à l'import
    if (summary.cover) parts.push("page de garde restaurée");
    if (summary.invalid?.length) parts.push(`${summary.invalid.length} élément${summary.invalid.length > 1 ? "s" : ""} invalide${summary.invalid.length > 1 ? "s" : ""}`);
    toast(`Import terminé : ${parts.join(", ")}.`, { type: summary.invalid?.length ? "warn" : "ok", timeout: 8000 });
    if (summary.invalid?.length) console.warn("Import — éléments invalides :", summary.invalid);
    closeImportModal();
    await load({ silent: true });
  } catch (err) {
    toast("Import impossible : " + err.message, { type: "error", timeout: 8000 });
  } finally {
    els.importConfirm.disabled = false;
  }
}

/* ==========================================================================
   Exports
   ========================================================================== */

/** URL d'un export, sélection comprise : `/api/export/pdf?status=Postulé&sort=…` */
function exportUrl(kind) {
  const target = EXPORTS[kind];
  if (!target) return "";
  if (!target.scoped) return target.url; // sauvegarde JSON : toujours complète
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(selectionParams())) {
    if (value) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${target.url}?${qs}` : target.url;
}

/**
 * Rappelle dans le menu ce que chaque entrée va contenir : c'est ce qui évite de
 * télécharger « tout le suivi » en croyant n'exporter que la sélection.
 */
export function renderExportMenu() {
  if (!els.exportNote) return;
  const shown = visibleApps().length;
  const total = state.apps.length;
  const scoped = hasActiveFilters();
  const mot = shown > 1 ? "s" : "";
  if (!scoped) {
    els.exportNote.textContent = `Tout le suivi (${total} candidature${total > 1 ? "s" : ""}) sera exporté.`;
  } else if (shown === total) {
    // Filtres actifs mais aucune ligne écartée : le dire évite de croire à un export partiel
    els.exportNote.textContent = `Filtres actifs : l'export contient quand même tout le suivi (${total} candidature${mot}).`;
  } else {
    els.exportNote.textContent = `PDF et CSV suivent la sélection affichée : ${shown} candidature${mot} sur ${total}.`;
  }
  els.exportNote.classList.toggle("alerting", scoped);
  if (els.exportPdfHint) els.exportPdfHint.textContent = scoped ? `${shown} filtrée${shown > 1 ? "s" : ""}` : "tableau imprimable";
  if (els.exportCsvHint) els.exportCsvHint.textContent = scoped ? `${shown} ligne${shown > 1 ? "s" : ""}` : "Excel / Sheets";
  if (els.coverPreview) els.coverPreview.href = exportUrl("pdf");
}

function runExport(kind) {
  const target = EXPORTS[kind];
  if (!target) return;
  closeMenus();
  const shown = visibleApps().length;
  const link = document.createElement("a");
  link.href = exportUrl(kind);
  // `download` déclenche le téléchargement ; `_blank` évite qu'un webview qui ignore
  // l'attribut remplace l'application par le contenu de l'export.
  link.download = "";
  link.target = "_blank";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  const scope = target.scoped && hasActiveFilters() ? ` (${shown} ligne${shown > 1 ? "s" : ""} filtrée${shown > 1 ? "s" : ""})` : "";
  toast(`${target.label}${scope} — téléchargement lancé.`, { type: "info", timeout: 3000 });
}

/* ==========================================================================
   Écouteurs
   ========================================================================== */

export function bindTransfer() {
  els.btnImport.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) openImportModal(file);
  });

  els.btnExportMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu(els.btnExportMenu, els.exportMenu);
  });
  els.exportMenu.addEventListener("click", (e) => {
    if (e.target.closest("[data-cover]")) return void openCoverModal();
    if (e.target.closest("[data-backups]")) return void openBackupsModal();
    const btn = e.target.closest("[data-export]");
    if (btn) runExport(btn.dataset.export);
  });

  els.importClose.addEventListener("click", closeImportModal);
  els.importCancel.addEventListener("click", closeImportModal);
  els.importConfirm.addEventListener("click", confirmImport);
  bindDialog(els.importModal, closeImportModal);
}
