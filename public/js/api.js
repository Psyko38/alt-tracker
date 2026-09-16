// Accès à l'API REST et chargement des données affichées.
"use strict";

import { state, els } from "./state.js";
import { toast, showEmpty } from "./ui.js";
import { scheduleRender } from "./render.js";

export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (err) {
    throw new Error("Serveur injoignable. Vérifiez que « npm start » tourne.");
  }
  const raw = await res.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = null; }
  }
  if (!res.ok) {
    const message =
      (data && (data.error || (Array.isArray(data.errors) && data.errors.join(" ")))) ||
      `Erreur ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function load({ silent = false } = {}) {
  if (!silent && !state.loaded) {
    els.skeleton.classList.remove("hidden");
    els.empty.classList.add("hidden");
  }
  try {
    const apps = await api("/api/applications");
    state.apps = Array.isArray(apps) ? apps : [];
    state.loaded = true;
    await fetchDashboard();
  } catch (err) {
    els.skeleton.classList.add("hidden");
    toast(err.message, { type: "error", timeout: 8000 });
    if (!state.loaded) {
      state.apps = [];
      showEmpty({
        title: "Données indisponibles",
        text: "Impossible de charger les candidatures. Le serveur est-il démarré ?",
        action: "Réessayer",
        onAction: () => load(),
      });
    }
    return;
  }
  els.skeleton.classList.add("hidden");
  scheduleRender();
}

/**
 * Chiffres, séries et analyses viennent tous du serveur : c'est lui qui les calcule
 * (règles partagées de lib/rules.js), et c'est donc le seul à pouvoir les recalculer.
 * Le navigateur les affiche, il ne les réinvente pas — sinon le même mot finit par
 * porter deux valeurs selon l'endroit de l'écran qui l'a calculé.
 */
export async function fetchDashboard() {
  try {
    state.dashboard = await api("/api/dashboard");
  } catch (dashboardError) {
    // Une relance ratée (serveur en cours de redémarrage, par exemple) ne doit pas
    // vider l'écran ni le laisser mélanger deux états : on garde le dernier état
    // connu en entier, et le prochain chargement le remplacera.
    console.warn("Dashboard indisponible", dashboardError);
  }
  return state.dashboard;
}

/**
 * Les chiffres du bandeau sont ceux de l'instantané du serveur en cours d'affichage :
 * ils bougent tous ensemble, jamais l'un sans les autres.
 */
export function dashboardStats() {
  return (state.dashboard && state.dashboard.stats) || null;
}
