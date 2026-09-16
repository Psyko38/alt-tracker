// Tests de la sélection partagée (lib/rules.js) : filtres, recherche, tri, limites.
// C'est la fonction qui sert à la fois à l'écran et aux exports — d'où l'insistance
// sur les cas où « ce que je vois » et « ce que j'exporte » pourraient diverger.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../lib/rules");

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

const base = {
  status: "Postulé",
  type: "Alternance",
  dateDemarche: iso(30).slice(0, 10),
  updatedAt: iso(1),
};

const jeux = [
  { id: "1", company: "Villefontaine", position: "Développeur", ...base, status: "Postulé" },
  { id: "2", company: "Arche Medical", position: "Webmaster", ...base, status: "Entretien", type: "CDI", updatedAt: iso(3), dateDemarche: iso(2).slice(0, 10) },
  { id: "3", company: "ECILIA", position: "Développeur full-stack", ...base, status: "Refus", type: "CDI", updatedAt: iso(5) },
  { id: "4", company: "Randstad Digital", position: "Data", ...base, status: "À postuler", type: "CDI", updatedAt: iso(9) },
  { id: "5", company: "EEMI Lyon", position: "Développeur", ...base, status: "Offre reçue", type: "Alternance", updatedAt: iso(0) },
];

describe("sélection partagée", () => {
  test("sans paramètre, la liste est rendue telle quelle (API inchangée)", () => {
    assert.deepEqual(rules.selectApps(jeux).map((a) => a.id), ["1", "2", "3", "4", "5"]);
    assert.deepEqual(rules.selectApps(jeux, {}).map((a) => a.id), ["1", "2", "3", "4", "5"]);
  });

  test("filtres par statut, type, entreprise et recherche libre", () => {
    assert.deepEqual(rules.selectApps(jeux, { status: "Refus" }).map((a) => a.id), ["3"]);
    assert.deepEqual(rules.selectApps(jeux, { type: "CDI" }).map((a) => a.id), ["2", "3", "4"]);
    assert.deepEqual(rules.selectApps(jeux, { company: "arche" }).map((a) => a.id), ["2"]); // insensible à la casse
    // La recherche libre couvre les champs utiles (poste, entreprise, notes…)
    assert.deepEqual(rules.selectApps(jeux, { q: "développeur" }).map((a) => a.id), ["1", "3", "5"]);
    assert.deepEqual(rules.selectApps(jeux, { q: "  data  " }).map((a) => a.id), ["4"]);
  });

  test("filtres rapides des cartes de statistiques", () => {
    assert.deepEqual(rules.selectApps(jeux, { quick: "sent" }).map((a) => a.id), ["1", "2", "3", "5"]);
    assert.deepEqual(rules.selectApps(jeux, { quick: "interview" }).map((a) => a.id), ["2", "5"]);
    assert.deepEqual(rules.selectApps(jeux, { quick: "refused" }).map((a) => a.id), ["3"]);
    // Un filtre rapide inconnu est ignoré (on n'exporte pas « rien » par accident)
    assert.equal(rules.selectApps(jeux, { quick: "inconnu" }).length, 5);
  });

  test("followup en texte : « false » est bien faux, true/1/on sont vrais", () => {
    assert.equal(rules.isOn("false"), false);
    assert.equal(rules.isOn("0"), false);
    assert.equal(rules.isOn(undefined), false);
    assert.equal(rules.isOn("true"), true);
    assert.equal(rules.isOn("1"), true);
    assert.equal(rules.isOn("on"), true);
    // La « Postulé » de 30 jours dort : elle est à relancer
    assert.deepEqual(rules.selectApps(jeux, { followup: "true" }).map((a) => a.id), ["1"]);
    assert.deepEqual(rules.selectApps(jeux, { followup: "false" }).length, 5);
  });

  test("plage de dates : bornes incluses, cumul avec les autres filtres", () => {
    const dates = [
      { id: "1", company: "A", status: "Postulé", dateDemarche: "2026-08-01", nextAction: "2026-09-20" },
      { id: "2", company: "B", status: "Postulé", dateDemarche: "2026-09-07", nextAction: "" },
      { id: "3", company: "C", status: "Refus", dateDemarche: "2026-09-12", nextAction: "" },
      { id: "4", company: "D", status: "Postulé", dateDemarche: "", nextAction: "" },
    ];
    const ids = (params) => rules.selectApps(dates, params).map((a) => a.id);

    // Une candidature tombant pile sur la borne est incluse (comme sur un calendrier)
    assert.deepEqual(ids({ from: "2026-09-07", to: "2026-09-12" }), ["2", "3"]);
    assert.deepEqual(ids({ from: "2026-09-08" }), ["3"]);
    assert.deepEqual(ids({ to: "2026-09-07" }), ["1", "2"]);
    // Sans date, impossible de situer la fiche : elle sort de la sélection
    assert.ok(!ids({ from: "2026-08-01" }).includes("4"));
    // La plage se cumule avec les autres filtres
    assert.deepEqual(ids({ from: "2026-09-01", to: "2026-09-30", status: "Postulé" }), ["2"]);
    assert.deepEqual(ids({ from: "2026-09-01", to: "2026-09-30", quick: "refused" }), ["3"]);
    assert.deepEqual(ids({ from: "2026-09-01", to: "2026-09-30", q: "b" }), ["2"]);
    // Autre champ : la relance prévue
    assert.deepEqual(ids({ from: "2026-09-01", to: "2026-09-30", dateField: "nextAction" }), ["1"]);
    assert.equal(rules.selectApps(dates, { dateField: "inconnu", from: "2026-09-01", to: "2026-09-30" }).length, 2);
    // Horodatage ISO complet accepté, borne illisible sans effet
    assert.deepEqual(ids({ from: "2026-09-07T10:00:00Z", to: "2026-09-12T23:00:00Z" }), ["2", "3"]);
    assert.equal(ids({ from: "pas-une-date" }).length, 4);
    assert.equal(ids({ from: "2026-13-45" }).length, 4, "une date impossible ne doit pas vider la liste");

    // Libellés affichés dans le titre de liste, l'en-tête du PDF et le nom du fichier
    assert.equal(rules.dateRangeLabel("2026-09-01", "2026-09-12"), "du 01/09/2026 au 12/09/2026");
    assert.equal(rules.dateRangeLabel("2026-09-12", "2026-09-12"), "le 12/09/2026");
    assert.equal(rules.dateRangeLabel("2026-09-01", ""), "à partir du 01/09/2026");
    assert.equal(rules.dateRangeLabel("", "2026-09-12"), "jusqu'au 12/09/2026");
    assert.equal(rules.dateRangeLabel("", ""), "");
    assert.equal(rules.dateRangeLabel("2026-09-01", "2026-09-12", "nextAction"), "prochaine action du 01/09/2026 au 12/09/2026");
  });

  test("limite et tri", () => {
    assert.deepEqual(rules.selectApps(jeux, { limit: "2" }).map((a) => a.id), ["1", "2"]);
    assert.deepEqual(rules.selectApps(jeux, { limit: "0" }).length, 5); // 0 = pas de limite
    assert.deepEqual(rules.selectApps(jeux, { sort: "company" }).map((a) => a.company), [
      "Arche Medical", "ECILIA", "EEMI Lyon", "Randstad Digital", "Villefontaine",
    ]);
    // Le tri par statut suit l'ordre du métier, pas l'alphabet
    assert.deepEqual(rules.selectApps(jeux, { sort: "status" }).map((a) => a.status), [
      "À postuler", "Postulé", "Entretien", "Offre reçue", "Refus",
    ]);
    assert.deepEqual(rules.selectApps(jeux, { sort: "company", dir: "desc" }).map((a) => a.company)[0], "Villefontaine");
    // La limite s'applique après le tri : sinon limit=1 renvoie le premier élément source.
    assert.deepEqual(rules.selectApps(jeux, { sort: "company", limit: "1" }).map((a) => a.company), ["Arche Medical"]);
    assert.deepEqual(rules.selectApps(jeux, { sort: "company", dir: "desc", limit: "1" }).map((a) => a.company), ["Villefontaine"]);
    // Tris de la liste déroulante
    assert.deepEqual(rules.selectApps(jeux, { selectSort: "date-asc" }).map((a) => a.id), ["4", "3", "2", "1", "5"]);
    assert.deepEqual(rules.selectApps(jeux, { selectSort: "demarche" }).map((a) => a.id)[0], "2");
  });

  test("la liste d'origine n'est jamais modifiée par le tri", () => {
    const copie = jeux.map((a) => a.id);
    rules.selectApps(jeux, { sort: "company", dir: "desc" });
    assert.deepEqual(jeux.map((a) => a.id), copie);
  });

  test("les statistiques portent sur la liste reçue", () => {
    const global = rules.computeStats(jeux);
    assert.equal(global.total, 5);
    assert.equal(global.sent, 4); // tout sauf « À postuler »
    assert.equal(global.interviews, 2); // Entretien + Offre reçue
    assert.equal(global.interviewsReached, 2); // aucun historique : même compte ici
    assert.equal(global.refused, 1);
    assert.equal(global.followUps, 1);
    assert.equal(global.rate, 50); // 2 entretiens obtenus / 4 envois

    const selection = rules.computeStats(rules.selectApps(jeux, { status: "Refus" }));
    assert.equal(selection.total, 1);
    assert.equal(selection.sent, 1);
    assert.equal(selection.rate, 0);
  });
});

describe("un mot, un chiffre", () => {
  const fiche = (over = {}) => ({
    id: "x",
    company: "Entreprise",
    position: "Dev",
    status: "Postulé",
    type: "CDI",
    dateDemarche: "2026-09-01",
    source: "",
    statusHistory: [],
    ...over,
  });
  const hist = (status, at) => ({ status, at });

  test("« envoyée » : la carte, le filtre rapide et la première marche disent la même chose", () => {
    const list = [
      fiche({ id: "1", status: "Postulé" }),
      // Remise « À postuler » par un import : elle a bien été envoyée un jour
      fiche({ id: "2", status: "À postuler", statusHistory: [hist("Postulé", "2026-09-02T08:00:00Z")] }),
      fiche({ id: "3", status: "À postuler" }),
    ];
    const stats = rules.computeStats(list);
    assert.equal(stats.sent, 2);
    assert.equal(rules.computeInsights(list).funnel[0].value, stats.sent, "la carte et l'entonnoir doivent annoncer le même total");
    // Le filtre rapide montre exactement les lignes que la carte compte
    assert.deepEqual(rules.selectApps(list, { quick: "sent" }).map((a) => a.id), ["1", "2"]);
    assert.equal(rules.selectApps(list, { quick: "sent" }).length, stats.sent);
  });

  test("« entretien » : le pipeline du jour et les étapes atteintes ne se confondent pas", () => {
    const list = [
      fiche({ id: "1", status: "Entretien" }),
      fiche({ id: "2", status: "Refus", statusHistory: [hist("Entretien", "2026-09-03T08:00:00Z"), hist("Refus", "2026-09-09T08:00:00Z")] }),
    ];
    const stats = rules.computeStats(list);
    assert.equal(stats.interviews, 1, "un entretien déjà passé puis refusé n'est plus en cours");
    assert.equal(stats.interviewsReached, 2, "mais l'entonnoir en garde la trace");
    assert.equal(rules.computeInsights(list).funnel[2].value, stats.interviewsReached);
    assert.equal(stats.rate, 100); // 2 entretiens obtenus sur 2 envois
    assert.deepEqual(rules.selectApps(list, { quick: "interview" }).map((a) => a.id), ["1"]);
  });
});

describe("analyses de recherche d'emploi", () => {
  const app = (over = {}) => ({
    id: "x",
    company: "Entreprise",
    position: "Dev",
    status: "Postulé",
    type: "CDI",
    dateDemarche: "2026-09-01",
    source: "",
    statusHistory: [],
    ...over,
  });
  const hist = (status, at) => ({ status, at });

  test("sans donnée, tout est à zéro et rien ne plante", () => {
    for (const vide of [[], undefined, null, "pas-une-liste"]) {
      const insights = rules.computeInsights(vide);
      assert.deepEqual(insights.funnel.map((step) => step.value), [0, 0, 0, 0]);
      assert.deepEqual(insights.sources, []);
      assert.deepEqual(insights.responseDelay, { count: 0, average: 0 });
    }
  });

  test("les sources se classent par volume, avec leur taux de réponse", () => {
    const list = [
      app({ id: "1", source: "LinkedIn" }),
      app({ id: "2", source: "LinkedIn", status: "Refus" }),
      app({ id: "3", source: "LinkedIn", status: "Entretien" }),
      app({ id: "4", source: "HelloWork", status: "Sans réponse" }),
      app({ id: "5", source: "HelloWork", status: "À postuler" }), // jamais envoyée : écartée
      app({ id: "6", status: "Postulé" }), // pas de source renseignée
    ];
    const { sources, funnel } = rules.computeInsights(list);
    assert.deepEqual(sources.map((row) => row.label), ["LinkedIn", "HelloWork", "Sans source"]);
    // 2 réponses sur 3 envois LinkedIn (un refus compte comme une réponse)
    assert.deepEqual(sources[0], { label: "LinkedIn", sent: 3, responses: 2, interviews: 1, rate: 67 });
    // « Sans réponse » n'est pas une réponse ; « À postuler » ne compte pas comme un envoi
    assert.equal(sources[1].rate, 0);
    assert.deepEqual(funnel.map((step) => step.value), [5, 2, 1, 0]);
    assert.deepEqual(funnel.map((step) => step.label), ["Envoyées", "Réponses", "Entretiens", "Offres"]);
  });

  test("l'historique compte : un entretien suivi d'un refus reste dans l'entonnoir", () => {
    const list = [
      app({
        id: "a",
        source: "LinkedIn",
        status: "Refus",
        statusHistory: [
          hist("Postulé", "2026-09-01T08:00:00Z"),
          hist("Entretien", "2026-09-05T08:00:00Z"),
          hist("Refus", "2026-09-09T08:00:00Z"),
        ],
      }),
    ];
    const { funnel, sources } = rules.computeInsights(list);
    assert.deepEqual(funnel.map((step) => step.value), [1, 1, 1, 0]);
    assert.equal(sources[0].interviews, 1);
    // Une candidature remise « À postuler » par un import reste comptée comme envoyée
    assert.equal(rules.wasSent(app({ status: "À postuler", statusHistory: [hist("Postulé", "2026-09-01T08:00:00Z")] })), true);
    assert.equal(rules.wasSent(app({ status: "À postuler" })), false);
  });

  test("le délai de réponse part de la date de démarche, sinon de la création", () => {
    const list = [
      app({ id: "a", dateDemarche: "2026-09-01", status: "Entretien", statusHistory: [hist("Entretien", "2026-09-05T08:00:00Z")] }),
      app({ id: "b", dateDemarche: "2026-09-01", status: "Refus", statusHistory: [hist("Refus", "2026-09-09T08:00:00Z")] }),
      app({ id: "c", dateDemarche: "2026-09-01" }), // toujours sans réponse : ignorée
      app({ id: "d", dateDemarche: "", createdAt: "2026-09-01T10:00:00Z", status: "Entretien", statusHistory: [hist("Entretien", "2026-09-04T10:00:00Z")] }),
    ];
    const { responseDelay } = rules.computeInsights(list);
    assert.equal(responseDelay.count, 3); // la candidature sans réponse ne compte pas
    assert.equal(responseDelay.average, 5); // (4 + 8 + 3) / 3

    assert.equal(rules.daysBetweenDays("2026-09-01", "2026-09-08"), 7);
    assert.equal(rules.daysBetweenDays("2026-09-08", "2026-09-01"), -7);
    assert.equal(rules.daysBetweenDays("", "2026-09-08"), null);
    assert.equal(rules.daysBetweenDays("pas-une-date", "2026-09-08"), null);
  });
});
