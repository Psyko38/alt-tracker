// Sauvegardes de la base : instantanés listables et restaurables.
"use strict";

import { state, els } from "./state.js";
import { escapeHtml, toast } from "./ui.js";
import { api, load } from "./api.js";
import { openOverlay, closeOverlay, confirmDialog, closeMenus, menuTrigger, bindDialog } from "./shell.js";

/**
 * "2026-09-14T15:04:05.000Z" → "14/09/2026 à 17:04:05".
 * Les secondes sont affichées : deux instantanés pris dans la même minute — un
 * avant une suppression, un autre avant un import — doivent rester distincts.
 */
function fmtWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${date.toLocaleDateString("fr-FR")} à ${heure}`;
}

/** 5120 → "5,0 ko" */
function fmtBytes(bytes) {
  const value = Number(bytes) || 0;
  return value < 1024 ? `${value} o` : `${(value / 1024).toFixed(1).replace(".", ",")} ko`;
}

/** Ce que contient un instantané : « 12 candidatures · 28,0 ko » (on choisit en connaissance de cause) */
function snapshotDetail(file) {
  const count = file.applications;
  const taille = fmtBytes(file.bytes);
  return typeof count === "number"
    ? `${count} candidature${count > 1 ? "s" : ""} · ${taille}`
    : taille;
}

export async function openBackupsModal() {
  // L'entrée du menu « Exporter » disparaît avec le menu : c'est le bouton du menu
  // qui reprendra le focus à la fermeture.
  const opener = menuTrigger(els.exportMenu);
  closeMenus();
  els.backupsList.innerHTML = "";
  els.backupsNote.textContent = "Chargement…";
  openOverlay(els.backupsModal, "#backups-create", opener);
  await refreshBackups();
}

export function closeBackupsModal() {
  closeOverlay(els.backupsModal);
}

async function refreshBackups() {
  try {
    renderBackups(await api("/api/backups"));
  } catch (err) {
    els.backupsNote.textContent = "Sauvegardes indisponibles.";
    els.backupsList.innerHTML = `<li class="backup-row quiet">${escapeHtml(err.message)}</li>`;
  }
}

function renderBackups(data) {
  const files = Array.isArray(data.files) ? data.files : [];
  state.backups = files;
  const keep = Number(data.keep) || 10;
  els.backupsNote.textContent = files.length
    ? `Un instantané est pris à chaque démarrage et avant chaque suppression ou import en remplacement. Les ${keep} plus récents sont conservés.`
    : "Aucun instantané pour l'instant : la base n'a pas encore été copiée.";
  els.backupsList.innerHTML = files
    .map(
      (file) => `
      <li class="backup-row">
        <span class="backup-when">${escapeHtml(fmtWhen(file.at))}<span class="backup-size">${escapeHtml(snapshotDetail(file))}</span></span>
        <button type="button" class="btn small" data-restore="${escapeHtml(file.name)}">Restaurer</button>
      </li>`
    )
    .join("");
}

/** Instantané à la demande : le geste « je m'apprête à faire quelque chose de risqué » */
async function createSnapshot() {
  els.backupsCreate.disabled = true;
  try {
    const res = await api("/api/backups", { method: "POST" });
    renderBackups(res);
    toast(`Instantané créé : ${res.created}`, { type: "ok" });
  } catch (err) {
    toast(err.message, { type: "error" });
  } finally {
    els.backupsCreate.disabled = false;
  }
}

async function restoreSnapshot(name) {
  // On confirme en français — « le 15/09/2026 à 09:57:54, 12 candidatures » — et non
  // avec un nom de fichier que personne ne lit.
  const file = (state.backups || []).find((candidate) => candidate.name === name);
  const cible = file ? `${fmtWhen(file.at)} (${snapshotDetail(file)})` : name;
  const ok = await confirmDialog({
    title: "Restaurer cette sauvegarde",
    message: `Le suivi reviendra à l'état du ${cible}. L'état actuel est copié avant : une restauration reste réversible.`,
    confirmLabel: "Restaurer",
    danger: true,
  });
  if (!ok) return;
  // Pendant la restauration, un second clic n'a aucun sens : on verrouille les boutons
  els.backupsList.querySelectorAll("button").forEach((btn) => { btn.disabled = true; });
  try {
    const res = await api("/api/backups/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    renderBackups(res);
    await load();
    toast(`Base restaurée : ${res.total} candidature${res.total > 1 ? "s" : ""}.`, { type: "ok", timeout: 6000 });
  } catch (err) {
    toast(err.message, { type: "error" });
    await refreshBackups();
  }
}

export function bindBackups() {
  els.backupsCreate.addEventListener("click", createSnapshot);
  els.backupsClose.addEventListener("click", closeBackupsModal);
  els.backupsCancel.addEventListener("click", closeBackupsModal);
  bindDialog(els.backupsModal, closeBackupsModal);
  els.backupsList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-restore]");
    if (btn) restoreSnapshot(btn.dataset.restore);
  });
}
