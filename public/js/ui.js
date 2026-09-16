// Primitives de présentation : échappement, icônes, pastilles, dates lisibles,
// notifications, panneau « rien à afficher ». Rien ici ne parle à l'API ni ne
// retient d'état : les modales, les menus et le thème vivent dans shell.js.
"use strict";

import { els } from "./state.js";

const { STATUS_TONE, TYPE_TONE, fmtDateFR, lastMoveAt, daysSinceActivity: daysSince, followUpDelay } = Rules;

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

/*
  Icônes — un seul jeu (le sprite SVG en tête de index.html). Toutes les icônes
  partagent la même grille de 24 px et la même épaisseur de trait : c'est la
  classe `.ico` qui les dimensionne et les colore, jamais le dessin lui-même.
*/

export function icon(name, extra = "") {
  return `<svg class="ico${extra ? " " + extra : ""}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

/** Remplace l'icône d'un `<svg class="ico">` déjà présent (thème, boutons d'état) */
export function setIcon(svg, name) {
  const use = svg && svg.querySelector("use");
  if (use) use.setAttribute("href", `#i-${name}`);
}

/** Bouton « icône + libellé » : le libellé vit dans .btn-label pour rester modifiable */
export function setButtonLabel(button, text) {
  const label = button && button.querySelector(".btn-label");
  if (label) label.textContent = text;
}

/** "06 12 34 56 78" → "tel:0612345678" (les navigateurs gèrent mal les espaces) */
export function telHref(value) {
  const digits = String(value ?? "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

/** Explication d'une relance automatique, pour les infobulles */
export function followUpReason(app) {
  const at = lastMoveAt(app);
  const move = at ? fmtDateFR(new Date(at).toISOString()) : "inconnu";
  return `Dernier mouvement : ${move} (il y a ${daysSince(app)} j) · délai de l'étape « ${app.status} » : ${followUpDelay(app)} j`;
}

/** "il y a 3 j", "aujourd'hui", "12/09/2026" */
export function relativeDay(iso) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} j`;
  return fmtDateFR(iso);
}

export function badge(text, tone, { dot = true } = {}) {
  return `<span class="badge ${tone}">${dot ? '<span class="dot" aria-hidden="true"></span>' : ""}${escapeHtml(text)}</span>`;
}

export function statusBadge(status) {
  return badge(status || "—", STATUS_TONE[status] || "neutral");
}

export function typeBadge(type) {
  if (!type) return `<span class="muted">—</span>`;
  return badge(type, TYPE_TONE[type] || "neutral");
}

/* --------------------------------------------------------------------------
   Notifications
   -------------------------------------------------------------------------- */

const TOAST_ICONS = { ok: "check", warn: "warning", error: "ban", info: "info" };

export function toast(message, { type = "info", timeout = 4500 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${icon(TOAST_ICONS[type] || "info")}</span>
    <div class="toast-body"></div>
    <button class="toast-close" type="button" aria-label="Fermer la notification">${icon("x", "ico-xs")}</button>
  `;
  el.querySelector(".toast-body").textContent = message;
  el.querySelector(".toast-close").addEventListener("click", () => dismiss());
  els.toasts.appendChild(el);

  let timer = timeout > 0 ? setTimeout(dismiss, timeout) : null;
  el.addEventListener("mouseenter", () => timer && clearTimeout(timer));

  function dismiss() {
    if (timer) clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 170);
  }

  return { dismiss };
}

/** Panneau d'état vide : titre, explication, action unique. */
export function showEmpty({ title, text, action, actionIcon = "plus", onAction }) {
  els.emptyTitle.textContent = title;
  els.emptyText.textContent = text;
  setButtonLabel(els.emptyAction, action);
  setIcon(els.emptyAction.querySelector(".ico"), actionIcon);
  els.emptyAction.onclick = onAction;
  els.empty.classList.remove("hidden");
}
