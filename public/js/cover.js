// Page de garde du PDF (page 1, rédigée par l'utilisateur).
"use strict";

import { state, els } from "./state.js";
import { api } from "./api.js";
import { toast } from "./ui.js";
import { openOverlay, closeOverlay, closeMenus, menuTrigger, bindDialog } from "./shell.js";

const COVER_TEXT_LIMIT = 4000;

function setCoverMenuState(enabled) {
  if (els.coverMenuHint) els.coverMenuHint.textContent = enabled ? "activée" : "désactivée";
}

export async function loadCover() {
  try {
    state.cover = await api("/api/cover");
  } catch {
    state.cover = state.cover || { enabled: false, title: "", subtitle: "", text: "", showStats: true };
  }
  setCoverMenuState(Boolean(state.cover.enabled));
  return state.cover;
}

function fillCoverForm(cover) {
  els.coverEnabled.checked = Boolean(cover.enabled);
  els.coverTitleInput.value = cover.title || "";
  els.coverSubtitleInput.value = cover.subtitle || "";
  els.coverTextInput.value = cover.text || "";
  els.coverStats.checked = cover.showStats !== false;
  updateCoverCount();
}

function updateCoverCount() {
  const len = els.coverTextInput.value.length;
  els.coverTextCount.textContent = len ? `${len} / ${COVER_TEXT_LIMIT} caractères` : "";
}

export async function openCoverModal() {
  // Comme pour les sauvegardes : on est ouvert depuis le menu « Exporter », dont
  // l'entrée ne sera plus là pour reprendre le focus.
  const opener = menuTrigger(els.exportMenu);
  closeMenus();
  await loadCover();
  fillCoverForm(state.cover);
  openOverlay(els.coverModal, "#cover-enabled", opener);
}

export function closeCoverModal() {
  closeOverlay(els.coverModal);
}

async function saveCoverForm(event) {
  event.preventDefault();
  const payload = {
    enabled: els.coverEnabled.checked,
    title: els.coverTitleInput.value.trim(),
    subtitle: els.coverSubtitleInput.value.trim(),
    text: els.coverTextInput.value,
    showStats: els.coverStats.checked,
  };
  els.coverSave.disabled = true;
  try {
    state.cover = await api("/api/cover", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setCoverMenuState(Boolean(state.cover.enabled));
    toast(
      payload.enabled
        ? "Page de garde enregistrée — elle sera la page 1 du PDF."
        : "Page de garde désactivée.",
      { type: "ok" }
    );
    closeCoverModal();
  } catch (err) {
    toast(err.message, { type: "error" });
  } finally {
    els.coverSave.disabled = false;
  }
}

export function bindCover() {
  els.coverForm.addEventListener("submit", saveCoverForm);
  els.coverClose.addEventListener("click", closeCoverModal);
  els.coverCancel.addEventListener("click", closeCoverModal);
  els.coverTextInput.addEventListener("input", updateCoverCount);
  bindDialog(els.coverModal, closeCoverModal);
}
