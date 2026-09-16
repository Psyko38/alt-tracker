// Vue d'ensemble : bandeau de chiffres, rendement de la recherche (entonnoir et
// sources), bandeau d'alerte des relances et graphiques.
// --------------------------------------------------------------------------
// Tous ces chiffres arrivent tels quels de `/api/dashboard`, où les règles
// partagées de lib/rules.js les ont calculés. Le navigateur les affiche, il ne
// les recalcule pas : la carte « Envoyées » ne peut pas contredire l'entonnoir.
"use strict";

import { state, els } from "./state.js";
import { escapeHtml, icon } from "./ui.js";
import { dashboardStats } from "./api.js";
import { setQuick, toggleFollowUp } from "./filters.js";

/* ==========================================================================
   Graphiques
   --------------------------------------------------------------------------
   Chaque graphique vit dans une carte du plateau : son canevas n'existe que
   lorsque le widget est affiché, et la carte disparaît puis revient au gré de la
   disposition. Ce que le plateau annonce (`bindCharts`) est donc la seule chose
   qui dit ici quels graphiques ont un canevas à l'écran.
   ========================================================================== */

// Couleurs des graphiques : elles viennent des jetons CSS (--chart-*), donc du
// thème en cours. Rien à retenir par cœur ici, et rien qui jure avec la page.
function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function chartColors() {
  return [1, 2, 3, 4, 5, 6, 7].map((i) => cssVar(`--chart-${i}`, "#b1552c"));
}

/** "#b1552c" + 0.12 → "rgba(177, 85, 44, 0.12)" — les jetons CSS de la palette sont en hexadécimal */
function withAlpha(color, alpha) {
  const n = parseInt(String(color).slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function renderDashboard(data) {
  if (typeof Chart === "undefined") return;
  const text = cssVar("--text", "#2e2a24");
  const muted = cssVar("--muted", "#6d6459");
  const grid = cssVar("--border", "#e8dfd1");
  const accent = cssVar("--chart-1", "#b1552c");
  const common = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: text, usePointStyle: true, boxWidth: 8 } } } };
  const destroy = (key) => { if (state.charts[key]) state.charts[key].destroy(); };
  // Un graphique dont la carte n'est pas dans le document ne se dessine pas : le
  // plateau l'a dit, et un canevas détaché mesure 0 px de toute façon.
  const draw = (chart, config) => {
    if (!liveCharts.has(chart.key)) return;
    const canvas = chartCanvas(chart);
    if (!canvas) return;
    destroy(chart.key);
    state.charts[chart.key] = new Chart(canvas, config);
  };
  draw(CHARTS[0], { type: "line", data: { labels: data.monthly.map((x) => x.label), datasets: [{ label: "Candidatures", data: data.monthly.map((x) => x.value), borderColor: accent, backgroundColor: withAlpha(accent, 0.12), borderWidth: 1.8, fill: true, tension: .35, pointRadius: 2.5, pointBackgroundColor: accent, pointBorderColor: cssVar("--card", "#fffcf7") }] }, options: { ...common, scales: { x: { ticks: { color: muted }, grid: { color: grid, drawTicks: false } }, y: { beginAtZero: true, ticks: { precision: 0, color: muted }, grid: { color: grid, drawTicks: false }, border: { display: false } } } } });
  for (const chart of CHARTS.slice(1)) {
    const values = data[chart.key].filter((x) => x.value > 0);
    draw(chart, { type: "doughnut", data: { labels: values.map((x) => x.label), datasets: [{ data: values.map((x) => x.value), backgroundColor: chartColors(), borderColor: cssVar("--card", "#fffcf7"), borderWidth: 2, hoverOffset: 2 }] }, options: { ...common, cutout: "66%" } });
  }
}

// Ce qui a déjà été dessiné : les séries affichées ne changent qu'avec une nouvelle
// réponse du serveur, et les couleurs qu'avec le thème. Un filtre, une recherche ou
// un tri ne touchent ni l'un ni l'autre — or `render()` est appelé à chaque frappe,
// et détruire puis recréer les trois graphiques coûtait 10 ms par rendu pour rien
// (mesuré : 46 ms par rendu avec, 36 ms sans).
let drawnDashboard = null;
let drawnTheme = null;
let drawnCanvases = null;

/**
 * Les trois graphiques : la clé de la série du serveur, l'id de leur widget au
 * catalogue du plateau et le canevas de chacun, tel qu'il est écrit dans la page.
 */
const CHARTS = [
  { key: "monthly", widget: "chart-monthly", canvas: "#applications-chart" },
  { key: "byStatus", widget: "chart-status", canvas: "#status-chart" },
  { key: "byType", widget: "chart-type", canvas: "#type-chart" },
];

/** Les graphiques dont la carte est dans le document — dit par le plateau, jamais deviné. */
const liveCharts = new Set();

const chartCanvas = (chart) => document.querySelector(chart.canvas);

/**
 * S'abonner à la vie des cartes de graphique : le plateau est seul à savoir quand
 * une carte entre dans le document ou en sort (js/dashboard.js), et il l'annonce.
 * On en déduit ce qu'il y a à détruire ou à redessiner, sans jamais relire le
 * document pour deviner si un canevas est encore là.
 *
 * L'abonnement est posé par app.js et non ici : le plateau importe déjà ce fichier
 * (pour `STAT_CARDS`), donc ce fichier ne peut pas importer le plateau.
 */
export function bindCharts(watch) {
  for (const chart of CHARTS) {
    watch(chart.widget, (inBoard) => {
      if (inBoard) liveCharts.add(chart.key);
      else liveCharts.delete(chart.key);
    });
  }
}

/**
 * Un graphique dont la carte a quitté le document — widget retiré du tableau de
 * bord — est détruit : garder une instance accrochée à un canevas détaché ne
 * dessine rien, et ce canevas mesure 0 px tant qu'il est dehors. Il sera redessiné
 * par le rendu qui le verra revenu (voir la clé du dessin ci-dessous).
 */
function pruneCharts() {
  for (const chart of CHARTS) {
    if (liveCharts.has(chart.key) || !state.charts[chart.key]) continue;
    state.charts[chart.key].destroy();
    delete state.charts[chart.key];
  }
}

export function refreshDashboard() {
  if (!state.dashboard) return;
  renderInsights(state.dashboard.insights);
  pruneCharts();
  const theme = document.documentElement.getAttribute("data-theme");
  // Les graphiques attachés font partie de la clé du dessin : un widget remis (ou
  // retiré) change ce qu'il y a à dessiner, même quand les chiffres n'ont pas bougé.
  const canvases = CHARTS.map((chart) => (liveCharts.has(chart.key) ? "1" : "0")).join("");
  if (state.dashboard === drawnDashboard && theme === drawnTheme && canvases === drawnCanvases) return;
  renderDashboard(state.dashboard);
  drawnDashboard = state.dashboard;
  drawnTheme = theme;
  drawnCanvases = canvases;
}

/* ==========================================================================
   Bandeau de chiffres
   --------------------------------------------------------------------------
   Chaque indicateur est un widget à part entière : son conteneur porte son
   propre id (`#stat-total`, `#stat-sent`…), posé par le plateau de js/dashboard.js.
   Un indicateur retiré du tableau de bord n'a plus de conteneur — il n'y a donc
   rien à dessiner, et le remettre le redessine au rendu suivant.
   ========================================================================== */

/**
 * Les six indicateurs, dans l'ordre du plateau. Les définitions vivent ici, avec
 * leur dessin : le catalogue des widgets (js/dashboard.js) vient les lire pour
 * nommer les cases du menu — un seul endroit décrit un indicateur.
 */
export const STAT_CARDS = [
  { id: "total", quick: "", label: "Candidatures", icon: "clipboard", value: (s) => s.total, sub: () => "toutes périodes" },
  { id: "sent", quick: "sent", label: "Envoyées", icon: "send", value: (s) => s.sent, sub: () => "déjà envoyées, historique compris" },
  { id: "interview", quick: "interview", label: "Entretiens en cours", icon: "calendar-check", value: (s) => s.interviews, sub: () => "entretiens et offres au statut actuel" },
  { id: "rate", quick: "", label: "Taux de réponse", icon: "trending-up", value: (s) => `${s.interviewRate} %`, sub: (s) => `${s.interviewsReached} entretiens obtenus ÷ ${s.sent} envois` },
  { id: "refused", quick: "refused", label: "Refus", icon: "ban", value: (s) => s.refused, sub: () => "à ne plus relancer" },
  { id: "followup", quick: "followup", label: "À relancer", icon: "bell", value: (s) => s.followUps, sub: () => "action due ou étape qui dort", alert: true },
];

export function renderStats() {
  const s = dashboardStats();
  if (!s) return;
  for (const card of STAT_CARDS) {
    const host = document.getElementById(`stat-${card.id}`);
    if (!host) continue; // indicateur retiré du tableau de bord : rien à dessiner
    const value = card.value(s);
    const active = Boolean(card.quick) && state.quick === card.quick;
    // Seules les cartes qui filtrent réellement la liste sont interactives :
    // « Candidatures » et « Taux de réponse » restent des indicateurs.
    if (card.quick) {
      host.dataset.quick = card.quick;
      host.setAttribute("aria-pressed", String(active));
      host.setAttribute("role", "button");
      host.setAttribute("tabindex", "0");
      host.title = active ? "Retirer ce filtre" : "Filtrer sur cette statistique";
    } else {
      host.title = card.label;
    }
    host.className = `stat${card.alert && value > 0 ? " alert" : ""}`;
    host.innerHTML = `
      <div class="stat-top">
        <span class="stat-label">${escapeHtml(card.label)}</span>
        <span class="stat-icon" aria-hidden="true">${icon(card.icon)}</span>
      </div>
      <div class="stat-num">${escapeHtml(value)}</div>
      <div class="stat-sub">${escapeHtml(card.sub(s))}</div>`;
  }
}

/* ==========================================================================
   Rendement de la recherche
   ========================================================================== */

/**
 * Quel canal répond, en combien de temps, et jusqu'où mène une candidature. Les
 * chiffres arrivent tels quels de `/api/dashboard`, où la règle partagée les a
 * calculés — donc identiques à ceux d'un agent IA, d'un export ou du PDF, et
 * recalculés au même endroit après chaque écriture.
 */
export function renderInsights(insights) {
  if (!els.insightsFunnel || !els.insightsSources || !insights) return;
  const { sources, responseDelay, funnel } = insights;
  const sent = funnel[0].value;
  const share = (value) => (sent ? Math.round((value / sent) * 100) : 0);

  els.insightsDelay.textContent = responseDelay.count
    ? `Réponse en ${responseDelay.average} j en moyenne · ${responseDelay.count} cas`
    : "Aucune réponse datée pour l'instant";

  if (!sent) {
    els.insightsFunnel.innerHTML = "";
    els.insightsSources.innerHTML =
      '<p class="muted small">Envoyez une première candidature : les analyses se remplissent d\'elles-mêmes.</p>';
    return;
  }

  els.insightsFunnel.innerHTML = funnel
    .map((step) => {
      const part = share(step.value);
      return `
        <li class="funnel-step">
          <span class="funnel-head">
            <span class="funnel-label">${escapeHtml(step.label)}</span>
            <span class="funnel-value">${step.value}</span>
          </span>
          <span class="funnel-bar"><i style="width:${part}%"></i></span>
          <span class="funnel-share">${part} %</span>
        </li>`;
    })
    .join("");

  els.insightsSources.innerHTML = sources.length
    ? sources
        .map(
          (row) => `
          <div class="source-row">
            <span class="source-name" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
            <span class="source-count">${row.sent} envoi${row.sent > 1 ? "s" : ""} · ${row.responses} réponse${row.responses > 1 ? "s" : ""}</span>
            <span class="source-bar"><i style="width:${row.rate}%"></i></span>
            <span class="source-rate">${row.rate} %</span>
          </div>`
        )
        .join("")
    : '<p class="muted small">Renseignez la source de vos candidatures (LinkedIn, HelloWork…) pour voir quel canal répond le mieux.</p>';
}

/* ==========================================================================
   Alertes et écouteurs
   ========================================================================== */

export function renderAlert() {
  const stats = dashboardStats();
  const followUps = stats ? stats.followUps : 0;
  els.alertBar.classList.toggle("hidden", followUps === 0);
  if (followUps > 0) {
    els.alertText.innerHTML = `<strong>${followUps} candidature${followUps > 1 ? "s" : ""}</strong> à relancer : prochaine action atteinte, ou aucun mouvement depuis le délai de l'étape (14 j après « Postulé », 10 j après « Relance envoyée », 7 j après « Entretien »).`;
    els.alertAction.textContent = state.quick === "followup" ? "Voir toutes" : "Voir les relances";
  }
}

export function bindOverview() {
  // Statistiques cliquables : la carte ne fait que demander la sélection, c'est
  // filters.js qui l'écrit (et qui redessine l'écran). L'écouteur est posé sur le
  // plateau, qui contient les six cartes et ne les recrée jamais.
  els.bento.addEventListener("click", (e) => {
    const card = e.target.closest("[data-quick]");
    if (card) setQuick(card.dataset.quick);
  });
  els.bento.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest("[data-quick]");
    if (!card) return;
    e.preventDefault();
    card.click();
  });

  // Bandeau d'alerte : la même bascule que la pastille « À relancer »
  els.alertAction.addEventListener("click", toggleFollowUp);
}
