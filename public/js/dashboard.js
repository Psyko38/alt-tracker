// Tableau de bord « bento » : la disposition des widgets.
// --------------------------------------------------------------------------
// L'écran n'est plus une pile de sections figées : chaque morceau (un
// indicateur, un graphique, la barre de recherche, la liste…) est un widget que
// l'on déplace, que l'on redimensionne, que l'on retire et que l'on remet. Ce
// fichier est le seul propriétaire de cette disposition — ordre, largeur et
// visibilité de chaque widget vivent dans `state.layout`, sont enregistrés dans
// le navigateur (comme les colonnes du tableau) et ne sont écrits nulle part
// ailleurs.
//
// Il ne dessine AUCUN contenu : il monte les cartes (un support + le gabarit de
// la page), les place et les rend manipulables. Ce qu'il y a dans une carte est
// déclaré dans index.html — un `<template id="tpl-…">` par widget, désigné par
// le catalogue — et dessiné par le module qui le possède : les chiffres et les
// graphiques par overview.js, les lignes du tableau par table.js, qui écrivent
// dans les éléments dont ce fichier garantit l'existence (#stat-total,
// #applications-chart, #applications-table…). Un widget retiré n'est pas détruit,
// il est détaché du document : le tableau Tabulator et les graphiques gardent
// leurs nœuds, et les retrouvent au retour — c'est à EUX de se construire ou de se
// redessiner quand leur conteneur revient (`renderTable` construit le tableau,
// `refreshDashboard` redessine les graphiques).
//
// Ce fichier est aussi le SEUL à savoir si une carte est dans le document ou non,
// et il le dit (`watchWidget`) au lieu de laisser chaque écran relire le document
// pour le deviner. Le plateau ne connaît donc aucun écran, et aucun écran n'a
// besoin de connaître le plateau.
"use strict";

import { state, els, cacheElements } from "./state.js";
import { escapeHtml, icon, setButtonLabel, setIcon, toast } from "./ui.js";
import { anyModalOpen, closeMenus, toggleMenu } from "./shell.js";
import { scheduleRender } from "./render.js";
import { STAT_CARDS } from "./overview.js";

/* ==========================================================================
   Catalogue
   ========================================================================== */

/** Largeurs disponibles, en colonnes de la grille du plateau (6 au total). */
const SIZES = [1, 2, 3, 6];
const SIZE_LABELS = { 1: "Étroit (1/6)", 2: "Moyen (2/6)", 3: "Large (3/6)", 6: "Pleine largeur" };

/**
 * Les widgets du tableau de bord, dans l'ordre du catalogue (celui de la
 * disposition d'origine) : c'est ICI qu'on voit quels widgets existent.
 *
 *  - `min` : la largeur en dessous de laquelle le widget ne veut pas descendre
 *    (un graphique d'une colonne ne montrerait rien) ; `size` : la largeur de la
 *    disposition d'origine.
 *  - `plain` : la carte ne dessine pas de cadre elle-même — les indicateurs
 *    portent le leur.
 *
 * Le contenu d'un widget est le `<template>` de index.html qui porte son id
 * (`tpl-<id>`), et le plateau en clone un exemplaire par carte : le gabarit, lui,
 * reste inerte. Un widget dont le gabarit manque n'est pas monté ; le test le dit.
 */
export const WIDGETS = [
  ...STAT_CARDS.map((card) => ({
    id: `stat-${card.id}`,
    label: card.label,
    group: "Indicateurs",
    icon: card.icon,
    plain: true,
    min: 1,
    size: 1,
  })),
  { id: "chart-monthly", label: "Évolution mensuelle", group: "Graphiques", icon: "trending-up", min: 2, size: 3 },
  { id: "chart-status", label: "Répartition par statut", group: "Graphiques", icon: "columns", min: 2, size: 3 },
  { id: "chart-type", label: "Types de contrat", group: "Graphiques", icon: "clipboard", min: 2, size: 3 },
  { id: "insights", label: "Rendement de la recherche", group: "Graphiques", icon: "sliders", min: 2, size: 3 },
  { id: "filters", label: "Recherche et filtres", group: "Liste", icon: "search", min: 2, size: 6 },
  { id: "table", label: "Toutes les candidatures", group: "Liste", icon: "table", min: 3, size: 6 },
];

const WIDGET_BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]));
const widgetOf = (id) => WIDGET_BY_ID.get(id) || null;

export const LAYOUT_KEY = "jt-dashboard";
const LAYOUT_VERSION = 1;

/* ==========================================================================
   Disposition : lecture, écriture, réordonnancement
   ========================================================================== */

/** La disposition d'origine — aussi ce que « Réinitialiser » repose. */
export function defaultLayout() {
  return { v: LAYOUT_VERSION, items: WIDGETS.map((widget) => ({ id: widget.id, size: widget.size, on: true })) };
}

/** Une largeur acceptable pour ce widget : dans la grille, et pas plus étroite que son minimum. */
function validSize(size, widget) {
  const value = Number(size);
  return SIZES.includes(value) && value >= widget.min ? value : widget.size;
}

/**
 * Relit une disposition enregistrée. Rien de ce qui vient du navigateur n'est cru
 * sur parole : les largeurs inconnues reprennent leur défaut, les widgets
 * disparus sont oubliés, les doublons ignorés — et les widgets arrivés depuis
 * l'enregistrement (une version plus récente de la page) sont ajoutés à la
 * suite, affichés, comme le sont les colonnes du tableau.
 */
export function parseLayout(raw) {
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null; // préférences illisibles : on repart de la disposition d'origine
  }
  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.items) ? parsed.items : [];
  const items = [];
  const seen = new Set();
  for (const entry of entries) {
    const widget = entry && widgetOf(entry.id);
    if (!widget || seen.has(widget.id)) continue;
    seen.add(widget.id);
    items.push({ id: widget.id, size: validSize(entry.size, widget), on: entry.on !== false });
  }
  for (const widget of WIDGETS) {
    if (!seen.has(widget.id)) items.push({ id: widget.id, size: widget.size, on: true });
  }
  return items.length ? { v: LAYOUT_VERSION, items } : defaultLayout();
}

/**
 * La même liste de widgets, rangée dans l'ordre donné par `ids` : ce sont les
 * cartes réellement présentes dans le plateau, dans leur ordre d'affichage. Les
 * widgets absents (retirés) suivent à la fin, dans leur ordre courant — leur
 * place d'origine les attend s'ils reviennent.
 */
export function orderItems(items, ids) {
  const rank = new Map(ids.map((id, index) => [id, index]));
  const placed = items.filter((item) => rank.has(item.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
  const rest = items.filter((item) => !rank.has(item.id));
  return [...placed, ...rest];
}

/**
 * Où tombe un widget lâché sur un autre : la liste des identifiants dans son
 * nouvel ordre. `after` place `dragId` après `targetId` (moitié droite ou basse
 * de la carte visée), sinon avant ; `targetId` à `null` veut dire « après tout
 * le monde ». Fonction pure : c'est elle que le glisser-déposer applique à
 * chaque survol, et elle qui doit pouvoir être relue.
 */
export function applyOrder(ids, dragId, targetId, after) {
  if (dragId === targetId || !ids.includes(dragId)) return ids.slice();
  const next = ids.slice();
  next.splice(next.indexOf(dragId), 1);
  const target = targetId === null ? -1 : next.indexOf(targetId);
  const at = target < 0 ? next.length : target + (after ? 1 : 0);
  next.splice(at, 0, dragId);
  return next;
}

/** La disposition affichée est-elle celle d'origine ? (ordre, largeurs et widgets affichés) */
export function isDefaultLayout(layout = state.layout) {
  if (!layout) return true;
  const origin = defaultLayout();
  return (
    layout.items.length === origin.items.length &&
    layout.items.every(
      (item, index) =>
        origin.items[index].id === item.id && origin.items[index].size === item.size && origin.items[index].on === item.on
    )
  );
}

function saveLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(state.layout));
  } catch { /* mode privé : la disposition ne survivra pas à l'onglet */ }
}

function loadLayout() {
  let raw = null;
  try {
    raw = localStorage.getItem(LAYOUT_KEY);
  } catch { /* idem */ }
  return parseLayout(raw);
}

/* ==========================================================================
   Le plateau : les nœuds, leur ordre, leur largeur
   ========================================================================== */

let host = null;
/** id du widget → sa carte. Jamais recréée : le tableau Tabulator vit dedans. */
const nodes = new Map();
/** Signature du dernier rangement dessiné (ordre + largeurs affichées). */
let drawnLayout = null;
let dragId = null;
let editing = false;
/** id du widget → les fonctions à prévenir quand sa carte entre ou sort du document. */
const watchers = new Map();

/* ==========================================================================
   Le contrat de vie d'un widget
   --------------------------------------------------------------------------
   Le plateau est le seul à savoir quand une carte entre dans le document ou en
   sort : c'est lui qui l'attache. Il le dit, au lieu de laisser les écrans relire
   le document pour deviner si leur conteneur est encore là. Les écrans qui
   possèdent un conteneur de widget s'abonnent une fois (voir app.js), et savoir
   où ils en sont devient une donnée reçue, pas une inspection.

   Ce qui est attaché n'a qu'une seule représentation : les nœuds du plateau. Le
   plateau n'en tient pas de copie ; il repose la question au moment où la réponse
   change (voir `renderDashboardLayout`).
   ========================================================================== */

/** Les widgets réellement dans le plateau, à cet instant — lus dans le plateau. */
const boardIds = () => new Set(host ? Array.from(host.children, (child) => child.dataset.widget) : []);

/**
 * S'abonner à la vie d'un widget : `onChange(inBoard)` est appelé tout de suite
 * avec l'état courant, puis à chaque entrée ou sortie du document. Cet appel
 * immédiat évite de distinguer « au démarrage » de « plus tard » : un abonné
 * branché après le premier rangement reçoit exactement la même information.
 */
export function watchWidget(id, onChange) {
  if (!watchers.has(id)) watchers.set(id, new Set());
  watchers.get(id).add(onChange);
  onChange(boardIds().has(id));
}

/** Annonce une entrée ou une sortie : à un abonné, jamais au document. */
function notify(id, inBoard) {
  for (const onChange of watchers.get(id) || []) onChange(inBoard);
}

/**
 * Annonce ce que le rangement vient de changer : ce que le plateau contenait avant,
 * ce qu'il contient après, comparés une fois, au seul moment où il bouge. Rien n'est
 * tenu à jour entre-temps.
 */
function announce(before, after) {
  for (const id of before) if (!after.has(id)) notify(id, false);
  for (const id of after) if (!before.has(id)) notify(id, true);
}

const enabledItems = () => state.layout.items.filter((item) => item.on);
const visibleIds = () => enabledItems().map((item) => item.id);

/** Le widget d'un élément de la page, à condition qu'il soit bien dans le plateau. */
function itemOf(target) {
  const node = target && target.closest ? target.closest("[data-widget]") : null;
  return node && host && host.contains(node) ? node : null;
}

/**
 * La barre d'un widget : la poignée, sa largeur, son déplacement, son retrait.
 * Elle n'apparaît qu'en mode « Organiser » — le reste du temps le plateau est
 * exactement la page d'avant, sans commandes qui traînent.
 */
function buildBar(widget) {
  const bar = document.createElement("div");
  bar.className = "bento-bar";
  bar.innerHTML = `
    <button class="bento-grip" type="button" draggable="true" aria-label="Déplacer le widget ${escapeHtml(widget.label)}" title="Glisser pour déplacer">${icon("grip")}</button>
    <span class="bento-name">${escapeHtml(widget.label)}</span>
    <select class="bento-size" aria-label="Largeur du widget ${escapeHtml(widget.label)}" title="Largeur du widget">
      ${SIZES.filter((size) => size >= widget.min)
        .map((size) => `<option value="${size}">${SIZE_LABELS[size]}</option>`)
        .join("")}
    </select>
    <button class="bento-btn" type="button" data-move="-1" aria-label="Déplacer le widget ${escapeHtml(widget.label)} vers la gauche" title="Déplacer vers la gauche">${icon("arrow-left", "ico-xs")}</button>
    <button class="bento-btn" type="button" data-move="1" aria-label="Déplacer le widget ${escapeHtml(widget.label)} vers la droite" title="Déplacer vers la droite">${icon("arrow-right", "ico-xs")}</button>
    <button class="bento-btn danger" type="button" data-remove aria-label="Retirer le widget ${escapeHtml(widget.label)}" title="Retirer ce widget">${icon("x", "ico-xs")}</button>
  `;
  return bar;
}

/**
 * La carte d'un widget : le support que le plateau déplace (`.bento-item`, la
 * largeur, l'id du widget) autour du contenu déclaré par la page. Le contenu est
 * un clone du gabarit — jamais le gabarit lui-même, qui ne sert qu'une fois.
 *
 * Le gabarit d'un widget porte son id (`tpl-table`, `tpl-chart-monthly`,
 * `tpl-stat-total`…). La convention s'écrit ici, une fois, et le test la vérifie
 * dans les deux sens : chaque widget a son gabarit, chaque gabarit son widget.
 */
function buildCard(widget) {
  const template = document.getElementById(`tpl-${widget.id}`);
  if (!template) return null;
  const node = document.createElement("div");
  node.className = widget.plain ? "bento-item plain" : "bento-item";
  node.dataset.widget = widget.id;
  node.append(template.content.cloneNode(true));
  node.prepend(buildBar(widget));
  return node;
}

/** Le menu « Widgets » : les cases à cocher qui ajoutent et retirent les cartes. */
export function renderWidgetsMenu() {
  if (!els.widgetsMenu) return;
  const groups = new Map();
  for (const widget of WIDGETS) {
    if (!groups.has(widget.group)) groups.set(widget.group, []);
    groups.get(widget.group).push(widget);
  }
  els.widgetsMenu.innerHTML = [...groups]
    .map(
      ([group, widgets]) => `
      <p class="menu-group">${escapeHtml(group)}</p>
      ${widgets
        .map(
          (widget) => `<label>
            <input type="checkbox" data-widget-toggle="${widget.id}" />
            ${icon(widget.icon, "ico-xs")}
            <span>${escapeHtml(widget.label)}</span>
          </label>`
        )
        .join("")}`
    )
    .join("");
  syncMenu();
}

/** Les cases du menu suivent la disposition : un widget ajouté se retrouve coché. */
function syncMenu() {
  if (!els.widgetsMenu || !state.layout) return;
  const shown = new Set(visibleIds());
  for (const box of els.widgetsMenu.querySelectorAll("[data-widget-toggle]")) {
    box.checked = shown.has(box.dataset.widgetToggle);
  }
}

/** Et chaque barre de widget affiche sa largeur en cours — y compris après un glissement. */
function syncBars() {
  for (const item of enabledItems()) {
    const node = nodes.get(item.id);
    const select = node && node.querySelector(".bento-size");
    if (select) select.value = String(item.size);
  }
}

/**
 * Range le plateau : un seul endroit décide de l'ordre, de la largeur et de ce qui
 * est affiché — il attache ce qui doit l'être, détache le reste, et n'y touche que
 * si la disposition a changé. Les éléments, eux, ne sont jamais recréés — seulement
 * déplacés ou détachés (voir la note en tête de fichier).
 */
export function renderDashboardLayout() {
  if (!host || !state.layout) return;
  const enabled = enabledItems();
  const signature = enabled.map((item) => `${item.id}:${item.size}`).join("|");
  if (signature !== drawnLayout) {
    // Ce qui entre et ce qui sort se lit une fois : un instantané du plateau avant
    // de ranger, et les cartes montées après. Les cartes montées, pas la disposition
    // voulue : un widget dont le gabarit manque n'a pas de carte, et l'annoncer
    // attaché ferait diverger le plateau de ce qu'il contient vraiment.
    const before = boardIds();
    drawnLayout = signature;
    const mounted = new Set(enabled.filter((item) => nodes.has(item.id)).map((item) => item.id));
    for (const [id, node] of nodes) {
      if (mounted.has(id)) continue;
      // Un widget retiré n'est pas détruit : il sort du document, avec tout ce
      // qu'il contient — le tableau Tabulator et les graphiques gardent leurs nœuds
      // et les retrouvent au retour.
      node.classList.remove("dragging", "drag-before", "drag-after");
      node.remove();
    }
    enabled.forEach((item, index) => {
      const node = nodes.get(item.id);
      if (!node) return;
      node.classList.remove(...SIZES.map((size) => `size-${size}`));
      node.classList.add(`size-${item.size}`);
      const current = host.children[index];
      if (current !== node) host.insertBefore(node, current || null);
    });
    announce(before, mounted);
  }
  syncMenu();
  syncBars();
  if (els.resetLayout) els.resetLayout.classList.toggle("hidden", isDefaultLayout());
}

/**
 * Le démarrage du plateau, en trois temps — et c'est ICI, une seule fois, que la
 * page doit les lire dans cet ordre :
 *
 *  1. monter tous les widgets, y compris ceux que la disposition enregistrée avait
 *     retirés : les gabarits sont instanciés ici, une fois pour la vie de la page ;
 *  2. remplir le registre des éléments (`cacheElements`) : ce que contiennent les
 *     widgets — la recherche, le tableau, les canevas — n'est trouvable qu'une fois
 *     monté, et un widget retiré au chargement doit y passer lui aussi avant de
 *     sortir du document ;
 *  3. appliquer la disposition enregistrée, qui range le plateau et en détache les
 *     retirés.
 *
 * Les trois tiennent dans la même passe, donc rien de tout cela ne se voit à
 * l'écran. Pour la même raison, le registre ne se remplit pas ailleurs (voir app.js) :
 * un élément des widgets n'existe pas avant l'étape 1.
 */
export function initDashboard() {
  host = document.getElementById("bento");
  state.layout = loadLayout();
  if (host) {
    for (const widget of WIDGETS) {
      const node = buildCard(widget);
      if (!node) continue;
      nodes.set(widget.id, node);
      host.append(node);
    }
  }
  cacheElements();
  if (!host) return;
  drawnLayout = null;
  renderWidgetsMenu();
  setEditMode(false);
  renderDashboardLayout();
}

/* ==========================================================================
   Ajouter, retirer, redimensionner, déplacer
   ========================================================================== */

/**
 * Ajoute ou retire un widget. Le retirer le détache du document sans le détruire :
 * le tableau et les graphiques gardent leur nœud, et le retrouvent au retour. Ce
 * que ça change pour eux, le plateau ne le sait pas et n'a pas à le savoir : il
 * annonce l'entrée ou la sortie (voir le contrat de vie, `watchWidget`), et le
 * rendu qui suit décide de ce qu'il y a à reconstruire ou à redessiner.
 */
export function setWidgetEnabled(id, on) {
  const item = state.layout && state.layout.items.find((entry) => entry.id === id);
  const widget = widgetOf(id);
  if (!item || !widget || item.on === on) return;
  item.on = on;
  saveLayout();
  renderDashboardLayout();
  toast(
    on ? `Widget « ${widget.label} » ajouté.` : `Widget « ${widget.label} » retiré — « Widgets » pour le remettre.`,
    { type: "ok", timeout: 3400 }
  );
  scheduleRender();
}

export function setWidgetSize(id, size) {
  const item = state.layout && state.layout.items.find((entry) => entry.id === id);
  const widget = widgetOf(id);
  if (!item || !widget) return;
  const next = validSize(size, widget);
  if (item.size === next) return;
  item.size = next;
  saveLayout();
  renderDashboardLayout();
  scheduleRender();
}

/** Déplacement au clavier (◀ ▶) : le même réordonnancement que le glisser-déposer. */
export function shiftWidget(id, direction) {
  const ids = visibleIds();
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return false;
  const next = applyOrder(ids, id, ids[target], direction > 0);
  state.layout.items = orderItems(state.layout.items, next);
  saveLayout();
  renderDashboardLayout();
  return true;
}

export function resetLayout() {
  state.layout = defaultLayout();
  saveLayout();
  renderDashboardLayout();
  toast("Disposition d'origine rétablie.", { type: "ok", timeout: 2600 });
  scheduleRender();
}

/* ==========================================================================
   Glisser-déposer
   --------------------------------------------------------------------------
   HTML5, sans bibliothèque : la poignée est l'élément glissable, la carte est
   l'image du glissement, et le plateau réordonne ses enfants pendant le survol
   (ce que l'on voit est ce qui sera enregistré). Chaque changement est écrit
   tout de suite : un dépôt avorté laisse la disposition telle qu'elle était
   affichée.
   ========================================================================== */

function clearDropMarks() {
  for (const node of nodes.values()) node.classList.remove("dragging", "drag-before", "drag-after");
}

/** Range les enfants du plateau selon `ids` (mêmes nœuds, nouvel ordre). */
function reorderDom(ids) {
  ids.forEach((id, index) => {
    const node = nodes.get(id);
    const current = host.children[index];
    if (node && current !== node) host.insertBefore(node, current || null);
  });
}

function onDragStart(event) {
  const grip = event.target.closest(".bento-grip");
  const node = itemOf(grip);
  if (!node || !event.dataTransfer) return;
  dragId = node.dataset.widget;
  node.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  // Firefox n'amorce un glissement que si le transfert porte quelque chose.
  event.dataTransfer.setData("text/plain", dragId);
  // L'image du glissement, c'est la carte entière — pas la seule poignée.
  event.dataTransfer.setDragImage(node, 26, 20);
}

function onDragOver(event) {
  if (!dragId) return;
  // Sans cette autorisation, le navigateur refuse le dépôt.
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const dragged = nodes.get(dragId);
  if (!dragged || !host.contains(dragged)) return;
  const over = itemOf(event.target);
  const ids = Array.from(host.children).map((child) => child.dataset.widget);
  // Au-dessus du vide, ou sur la carte déjà saisie : rien à changer.
  if (!over || over.dataset.widget === dragId) return;
  const rect = over.getBoundingClientRect();
  const after = event.clientX > rect.left + rect.width / 2;
  clearDropMarks();
  over.classList.add(after ? "drag-after" : "drag-before");
  reorderDom(applyOrder(ids, dragId, over.dataset.widget, after));
}

/** Le dépôt (ou la fin du glissement) écrit la disposition une bonne fois. */
function commitDrag() {
  if (!dragId) return;
  const ids = Array.from(host.children).map((child) => child.dataset.widget);
  state.layout.items = orderItems(state.layout.items, ids);
  dragId = null;
  // La seule invalidation manuelle qui reste, et elle a sa raison : pendant le survol,
  // `reorderDom` a déjà rangé le DOM, donc il peut être en avance sur la disposition
  // enregistrée — un dépôt qui retombe au même endroit donnerait la même signature, et
  // l'écran ne serait pas redessiné. Ailleurs la signature suffit (elle porte l'ordre,
  // les largeurs et les widgets affichés) : inutile de la remettre à `null`.
  drawnLayout = null;
  clearDropMarks();
  saveLayout();
  renderDashboardLayout();
}

function onBarClick(event) {
  const node = itemOf(event.target);
  if (!node) return;
  const id = node.dataset.widget;
  if (event.target.closest("[data-remove]")) {
    setWidgetEnabled(id, false);
    return;
  }
  const move = event.target.closest("[data-move]");
  if (move) shiftWidget(id, Number(move.dataset.move));
}

function onBarChange(event) {
  if (!event.target.classList.contains("bento-size")) return;
  const node = itemOf(event.target);
  if (node) setWidgetSize(node.dataset.widget, Number(event.target.value));
}

/* ==========================================================================
   Mode « Organiser »
   ========================================================================== */

export function setEditMode(on) {
  editing = Boolean(on);
  if (host) host.dataset.edit = editing ? "true" : "false";
  els.btnLayout.setAttribute("aria-pressed", String(editing));
  setButtonLabel(els.btnLayout, editing ? "Terminer" : "Organiser");
  setIcon(els.btnLayout.querySelector(".ico"), editing ? "check" : "sliders");
  if (!editing) clearDropMarks();
}

export function bindDashboard() {
  if (!host) return;

  els.btnWidgets.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu(els.btnWidgets, els.widgetsMenu);
  });
  els.widgetsMenu.addEventListener("change", (event) => {
    const id = event.target.dataset.widgetToggle;
    if (id) setWidgetEnabled(id, event.target.checked);
  });
  els.btnLayout.addEventListener("click", () => setEditMode(host.dataset.edit !== "true"));
  els.resetLayout.addEventListener("click", resetLayout);

  host.addEventListener("click", onBarClick);
  host.addEventListener("change", onBarChange);
  host.addEventListener("dragstart", onDragStart);
  host.addEventListener("dragover", onDragOver);
  host.addEventListener("drop", (event) => {
    if (!dragId) return;
    event.preventDefault();
    // Déposé sur le fond du plateau (la gouttière, ou sous la dernière rangée) : le
    // widget part en fin de liste. Sur une carte, c'est le survol qui a déjà rangé.
    if (!itemOf(event.target)) {
      const ids = Array.from(host.children).map((child) => child.dataset.widget);
      reorderDom(applyOrder(ids, dragId, null, false));
    }
    commitDrag();
  });
  // Le glissement peut se terminer sans dépôt (Échap, sortie de la fenêtre) :
  // ce qui a été rangé pendant le survol est enregistré de la même façon.
  host.addEventListener("dragend", commitDrag);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editing && !anyModalOpen()) setEditMode(false);
  });
}
