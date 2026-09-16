// Lecture agrégée : les chiffres des cartes, du tableau de bord et des analyses.
// Aucune écriture : ce module ne fait que résumer une liste de candidatures — celle
// qu'on lui donne, ou celle de la base. Les définitions (envoyées, réponses,
// entonnoir) appartiennent à lib/rules.js : ici, on les met en forme pour l'API.
const { STATUSES, TYPES, computeStats, computeInsights, normalizeDay } = require("./rules");
const { readApplications } = require("./sqlite");

function getStats(apps = readApplications()) {
  const list = Array.isArray(apps) ? apps : [];
  const common = computeStats(list);
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const app of list) byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
  const byType = list.reduce((counts, app) => {
    const type = app.type || "Non précisé";
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
  return {
    total: common.total,
    sent: common.sent,
    interviews: common.interviews,
    // Entretiens DÉJÀ obtenus (historique compris) : c'est ce chiffre qui donne le
    // taux de réponse, alors que `interviews` décrit le pipeline du jour.
    interviewsReached: common.interviewsReached,
    refused: common.refused,
    interviewRate: common.rate,
    followUps: common.followUps,
    byStatus,
    byType,
    statuses: STATUSES,
    types: TYPES,
  };
}

function getDashboard(apps = readApplications()) {
  const list = Array.isArray(apps) ? apps : [];
  const stats = getStats(list);
  const byStatus = Object.entries(stats.byStatus).map(([label, value]) => ({ label, value }));
  const byType = Object.entries(stats.byType).map(([label, value]) => ({ label, value }));
  const monthly = [];
  const cursor = new Date();
  cursor.setDate(1);
  cursor.setMonth(cursor.getMonth() - 11);

  for (let index = 0; index < 12; index += 1) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    monthly.push({
      key,
      label: cursor.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
      value: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const monthMap = new Map(monthly.map((month) => [month.key, month]));
  for (const app of list) {
    const day = normalizeDay(app.dateDemarche);
    const month = day ? monthMap.get(day.slice(0, 7)) : null;
    if (month) month.value += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    stats,
    byStatus,
    byType,
    monthly,
    insights: computeInsights(list),
  };
}

module.exports = { getStats, getDashboard };
