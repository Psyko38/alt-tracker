// Ossature de la page : modales (ouverture, fermeture, contrat clavier,
// confirmation), menus déroulants, thème et restauration du focus après un
// rendu. Tout ce qui est partagé par plusieurs écrans vit ici ; chaque écran
// branche ses propres écouteurs, et chaque modale y prend son contrat clavier
// avec `bindDialog`.
//
// Sens des dépendances : cette ossature est importée par tous les écrans, donc
// elle n'importe AUCUN écran — seulement les feuilles (`state.js`, `ui.js`). Ce
// qu'un écran doit faire en réaction (redessiner ses graphiques quand le thème
// change, par exemple) lui est passé par `app.js`, qui connaît les deux côtés.
"use strict";

import { els, state, $, $$ } from "./state.js";
import { setIcon } from "./ui.js";

/* ==========================================================================
   Modales (fermeture, piège de focus, restauration du focus)
   ========================================================================== */

const focusStack = [];

/**
 * Ouvre une modale et retient d'où l'on vient, pour y rendre le focus en la fermant.
 * `restoreTo` sert aux modales ouvertes depuis un menu déroulant : l'entrée cliquée
 * disparaît avec le menu, c'est donc le bouton du menu qui reprend le focus.
 */
export function openOverlay(el, focusSel, restoreTo) {
  focusStack.push(restoreTo || document.activeElement);
  el.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  // Sinon la modale se rouvre à la position de défilement de la fois précédente
  el.scrollTop = 0;
  const content = el.querySelector(".modal-content");
  if (content) content.scrollTop = 0;
  const target = focusSel && el.querySelector(focusSel);
  if (target) target.focus();
}

export function closeOverlay(el) {
  el.classList.add("hidden");
  if (!$$(".modal:not(.hidden)").length) document.body.style.overflow = "";
  const back = focusStack.pop();
  if (back && document.contains(back) && typeof back.focus === "function") back.focus();
}

export function anyModalOpen() {
  return $$(".modal:not(.hidden)").length > 0;
}

function trapFocus(container, event) {
  const focusables = Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Contrat clavier d'une boîte de dialogue, écrit une fois pour toutes :
 * — Tab et Maj+Tab tournent à l'intérieur de la modale ouverte ;
 * — Échap la ferme, et le gestionnaire global n'a pas à choisir à sa place ;
 * — un clic sur le fond la ferme aussi ;
 * — le focus revient à l'élément qui l'a ouverte (voir `openOverlay`).
 * Chaque modale appelle `bindDialog` avec sa propre fonction de fermeture :
 * impossible d'en ajouter une qui oublie une des quatre règles.
 */
export function bindDialog(modal, close) {
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      trapFocus(modal.querySelector(".modal-content"), e);
      return;
    }
    if (e.key === "Escape") {
      // On ferme ici, et on arrête l'événement : le gestionnaire global ne doit pas
      // fermer une autre modale que celle où se trouve le focus.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
}

export function confirmDialog({ title = "Confirmer", message = "", confirmLabel = "Confirmer", danger = false }) {
  els.confirmTitle.textContent = title;
  els.confirmText.textContent = message;
  els.confirmOk.textContent = confirmLabel;
  els.confirmOk.classList.toggle("danger", danger);
  els.confirmOk.classList.toggle("primary", !danger);
  openOverlay(els.confirmModal, "#confirm-ok");
  return new Promise((resolve) => {
    state.confirmResolve = resolve;
  });
}

export function resolveConfirm(value) {
  const resolve = state.confirmResolve;
  state.confirmResolve = null;
  closeOverlay(els.confirmModal);
  if (resolve) resolve(value);
}

/* ==========================================================================
   Menus déroulants
   ========================================================================== */

/** Le bouton qui commande un menu déroulant — c'est lui qui porte `aria-controls`. */
export function menuTrigger(menu) {
  return (menu && document.querySelector(`[aria-controls="${menu.id}"]`)) || null;
}

/**
 * Referme les menus déroulants. `restoreFocus` rend le focus au bouton du menu
 * fermé : c'est le cas d'Échap, pas celui d'un clic ailleurs, qui lui a sa propre
 * cible et ne doit pas se la faire voler.
 */
export function closeMenus({ restoreFocus = false } = {}) {
  for (const btn of [$("#btn-export-menu"), $("#btn-columns"), $("#btn-widgets")]) {
    if (!btn) continue;
    const menu = document.getElementById(btn.getAttribute("aria-controls"));
    const wasOpen = Boolean(menu && !menu.classList.contains("hidden"));
    btn.setAttribute("aria-expanded", "false");
    if (menu) menu.classList.add("hidden");
    if (restoreFocus && wasOpen) btn.focus();
  }
}

export function toggleMenu(button, menu) {
  const isOpen = !menu.classList.contains("hidden");
  closeMenus();
  if (!isOpen) {
    menu.classList.remove("hidden");
    button.setAttribute("aria-expanded", "true");
  }
}

/* ==========================================================================
   Thème
   ========================================================================== */

const THEME_KEY = "jt-theme";

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  setIcon(els.themeIcon, theme === "dark" ? "sun" : "moon");
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

/* ==========================================================================
   Focus après re-rendu
   --------------------------------------------------------------------------
   Stats, pastilles, en-têtes et lignes sont reconstruits à chaque rendu :
   l'élément qui avait le focus disparaît et le clavier revient sur <body>.
   On identifie l'élément par ses attributs data-* et par sa ligne, puis on
   rend le focus au même endroit logique après le rendu.
   ========================================================================== */

const FOCUS_ATTRS = ["data-quick", "data-status", "data-sort", "data-action", "data-field"];

export function focusKeyOf(el) {
  if (!el || el === document.body || typeof el.hasAttribute !== "function") return "";
  for (const attr of FOCUS_ATTRS) {
    if (!el.hasAttribute(attr)) continue;
    const tr = el.closest("tr");
    return `${attr}:${el.getAttribute(attr)}@${tr ? tr.dataset.id || "" : ""}`;
  }
  return "";
}

export function refocus(key) {
  if (!key) return;
  const candidates = document.querySelectorAll(FOCUS_ATTRS.map((a) => `[${a}]`).join(","));
  for (const el of candidates) {
    if (focusKeyOf(el) === key) {
      el.focus({ preventScroll: true });
      return;
    }
  }
}

/* ==========================================================================
   Écouteurs du chrome (thème, menus, modale de confirmation)
   ========================================================================== */

/**
 * Branche le chrome de la page.
 *
 * `onThemeChange` est appelé après chaque changement de thème : les couleurs des
 * graphiques viennent des jetons CSS, c'est donc à l'écran qui les dessine de les
 * redessiner. Cette ossature ne sait pas lequel — `app.js` lui passe
 * `refreshDashboard` (voir la note sur le sens des dépendances en tête de fichier).
 */
export function bindShell({ onThemeChange }) {
  els.btnTheme.addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    // Les graphiques lisent leurs couleurs dans le thème : on les redessine.
    onThemeChange();
  });

  // Un clic ailleurs referme les menus déroulants
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) closeMenus();
  });

  // Boîte de confirmation
  els.confirmOk.addEventListener("click", () => resolveConfirm(true));
  els.confirmCancel.addEventListener("click", () => resolveConfirm(false));
  els.confirmClose.addEventListener("click", () => resolveConfirm(false));
  bindDialog(els.confirmModal, () => resolveConfirm(false));
}
