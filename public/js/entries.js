// Fiche candidature : modale d'ajout / édition, détection de doublon,
// suppression.
"use strict";

import { state, els } from "./state.js";
import { statusBadge, relativeDay, escapeHtml, toast } from "./ui.js";
import { confirmDialog, openOverlay, closeOverlay, bindDialog } from "./shell.js";
import { api, load } from "./api.js";

const { STATUSES, TYPES, todayISO } = Rules;

/**
 * Options d'un <select> : les valeurs connues, plus la valeur courante si elle
 * est inconnue (statut ou type libre arrivé par import) — sinon le select
 * s'affichait vide et l'enregistrement échouait en 400.
 */
export function optionsFor(values, current) {
  const list = !current || values.includes(current) ? values : [...values, current];
  return list
    .map((v) => `<option value="${escapeHtml(v)}"${v === current ? " selected" : ""}>${escapeHtml(v)}</option>`)
    .join("");
}

function renderHistory(app) {
  const history = Array.isArray(app?.statusHistory) ? app.statusHistory.slice().reverse() : [];
  if (!history.length) {
    els.historyBox.classList.add("hidden");
    return;
  }
  els.historyList.innerHTML = history
    .map(
      (h) => `<li>${statusBadge(h.status)}
        <span class="muted small">${relativeDay(h.at)} · ${new Date(h.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></li>`
    )
    .join("");
  els.historyBox.classList.remove("hidden");
}

function findDuplicate(company, excludeId) {
  const value = String(company || "").trim().toLowerCase();
  if (!value) return null;
  return state.apps.find(
    (a) => String(a.company || "").trim().toLowerCase() === value && a.id !== excludeId
  ) || null;
}

function updateDupHint() {
  const dup = findDuplicate(els.fCompany.value, state.editingId);
  els.dupHint.classList.toggle("hidden", !dup);
  if (dup) {
    els.dupHint.textContent = `⚠️ Une candidature existe déjà chez « ${dup.company} » (${dup.position} — ${dup.status}).`;
  }
}

function setFormError(message) {
  els.formError.textContent = message || "";
  els.formError.classList.toggle("hidden", !message);
}

export function openFormModal(app = null) {
  state.editingId = app ? app.id : null;
  els.modalTitle.textContent = app ? "Modifier la candidature" : "Nouvelle candidature";
  els.modalSub.textContent = app
    ? `${app.company} — ${app.position}`
    : "Les champs marqués d'une * sont obligatoires.";

  els.fCompany.value = app?.company || "";
  els.fPosition.value = app?.position || "";
  // Les listes sont régénérées à chaque ouverture : un statut ou un type libre
  // arrivé par import reste proposé (et sélectionné) au lieu de disparaître.
  els.fStatus.innerHTML = optionsFor(STATUSES, app?.status || "À postuler");
  els.fType.innerHTML = optionsFor(TYPES, app?.type || "CDI");
  els.fStatus.value = app?.status || "À postuler";
  els.fType.value = app?.type || "CDI";
  els.fDateDemarche.value = app?.dateDemarche || todayISO();
  els.fNextAction.value = app?.nextAction || "";
  els.fPostalCode.value = app?.postalCode || "";
  els.fLocation.value = app?.location || "";
  els.fSource.value = app?.source || "";
  els.fSalary.value = app?.salary || "";
  els.fUrl.value = app?.url || "";
  els.fContactName.value = app?.contactName || "";
  els.fContactPhone.value = app?.contactPhone || "";
  els.fContactEmail.value = app?.contactEmail || "";
  els.fNotes.value = app?.notes || "";

  els.btnDelete.classList.toggle("hidden", !app);
  els.btnSave.textContent = app ? "Enregistrer les modifications" : "Ajouter la candidature";
  setFormError("");
  updateDupHint();
  renderHistory(app);
  openOverlay(els.modal, "#f-company");
}

export function closeFormModal() {
  closeOverlay(els.modal);
  state.editingId = null;
  els.form.reset();
  setFormError("");
}

async function saveForm(event) {
  event.preventDefault();

  const payload = {
    company: els.fCompany.value.trim(),
    position: els.fPosition.value.trim(),
    status: els.fStatus.value,
    type: els.fType.value,
    dateDemarche: els.fDateDemarche.value,
    nextAction: els.fNextAction.value,
    postalCode: els.fPostalCode.value,
    location: els.fLocation.value,
    source: els.fSource.value,
    salary: els.fSalary.value,
    url: els.fUrl.value,
    contactName: els.fContactName.value,
    contactPhone: els.fContactPhone.value,
    contactEmail: els.fContactEmail.value,
    notes: els.fNotes.value,
  };

  if (!payload.company || !payload.position) {
    const missing = !payload.company ? els.fCompany : els.fPosition;
    setFormError("Renseignez l'entreprise et l'intitulé du poste.");
    missing.focus();
    return;
  }

  const dup = findDuplicate(payload.company, state.editingId);
  if (dup) {
    const goOn = await confirmDialog({
      title: "Doublon détecté",
      message: `Une candidature existe déjà chez « ${dup.company} » pour le poste « ${dup.position} » (${dup.status}). Enregistrer quand même ?`,
      confirmLabel: "Enregistrer quand même",
    });
    if (!goOn) return;
  }

  const id = state.editingId;
  els.btnSave.disabled = true;
  setFormError("");
  try {
    await api(id ? `/api/applications/${encodeURIComponent(id)}` : "/api/applications", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    toast(id ? "Candidature mise à jour." : `Candidature ajoutée pour « ${payload.company} ».`, { type: "ok" });
    closeFormModal();
    await load({ silent: true });
  } catch (err) {
    setFormError(err.message);
    toast(err.message, { type: "error" });
  } finally {
    els.btnSave.disabled = false;
  }
}

export async function deleteApplication(app, { fromModal = false } = {}) {
  const ok = await confirmDialog({
    title: "Supprimer la candidature",
    message: `Supprimer définitivement « ${app.company} — ${app.position} » ? Cette action est irréversible.`,
    confirmLabel: "Supprimer",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/applications/${encodeURIComponent(app.id)}`, { method: "DELETE" });
    toast("Candidature supprimée.", { type: "ok" });
    if (fromModal) closeFormModal();
    await load({ silent: true });
  } catch (err) {
    toast(err.message, { type: "error" });
  }
}

export function bindEntries() {
  els.btnAdd.addEventListener("click", () => openFormModal());
  // Modale formulaire
  els.form.addEventListener("submit", saveForm);
  els.modalClose.addEventListener("click", closeFormModal);
  els.btnCancel.addEventListener("click", closeFormModal);
  bindDialog(els.modal, closeFormModal);
  els.btnDelete.addEventListener("click", () => {
    const app = state.apps.find((a) => a.id === state.editingId);
    if (app) deleteApplication(app, { fromModal: true });
  });
  els.fCompany.addEventListener("input", updateDupHint);
}
