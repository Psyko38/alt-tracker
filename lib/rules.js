// Règles métier partagées par le serveur ET la page — module « dual », sans build :
// côté Node il s'importe avec require(), côté navigateur le même fichier est chargé
// en <script> (voir la route /rules.js dans server.js) et expose window.Rules.
//
// Raison d'être : les délais de relance, les statuts et les tons des pastilles
// étaient écrits deux fois (dans le store et dans la page), avec un commentaire
// « doit rester aligné » — la meilleure façon d'afficher un jour des relances
// différentes dans l'interface et dans le PDF. Ici, une seule vérité — et c'est
// la seule porte : chacun de ses consommateurs fait `require("./rules")`.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATUSES = [
    "À postuler",
    "Postulé",
    "Relance envoyée",
    "Entretien",
    "Offre reçue",
    "Refus",
    "Sans réponse",
  ];

  const TYPES = ["CDI", "CDD", "Alternance", "Stage", "Freelance"];

  // Champs de tri exposés par l'API et par les colonnes de l'interface. Les champs
  // calculés (contact et lastMove) restent ici pour que le serveur et le navigateur
  // acceptent exactement le même vocabulaire.
  const SORT_FIELDS = [
    "company",
    "position",
    "status",
    "type",
    "dateDemarche",
    "nextAction",
    "lastMove",
    "location",
    "contact",
    "contactPhone",
    "postalCode",
    "source",
    "salary",
    "url",
    "notes",
  ];
  const SELECT_SORTS = ["date-desc", "date-asc", "demarche", "company", "status"];


  // Tons des pastilles (l'interface les traduit en CSS, le PDF en couleurs RGB)
  const STATUS_TONE = {
    "À postuler": "neutral",
    Postulé: "info",
    "Relance envoyée": "accent",
    Entretien: "warn",
    "Offre reçue": "ok",
    Refus: "danger",
    "Sans réponse": "neutral",
  };

  const TYPE_TONE = {
    CDI: "info",
    CDD: "neutral",
    Alternance: "accent",
    Stage: "warn",
    Freelance: "ok",
  };

  // Statuts qui ne déclenchent plus jamais de relance : la candidature est
  // terminée (refus, offre, silence définitif) ou n'a jamais été envoyée.
  const NO_FOLLOWUP_STATUSES = ["Refus", "Sans réponse", "Offre reçue", "À postuler"];

  // Délai (en jours) avant de considérer qu'une candidature « dort », par étape.
  // Le compteur repart du DERNIER MOUVEMENT, pas de la date de démarche : une
  // candidature postulée en juin mais passée en « Entretien » hier n'est pas à
  // relancer. Les statuts inconnus (import) retombent sur le délai par défaut.
  const FOLLOWUP_DELAYS = {
    Postulé: 14,
    "Relance envoyée": 10,
    Entretien: 7,
  };
  const FOLLOWUP_DELAY_DEFAULT = 14;

  /** "2026-09-12" ou "2026-09-12T10:00:00Z" → "12/09/2026" */
  function fmtDateFR(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).split("T")[0].split("-");
    return d && m && y ? `${d}/${m}/${y}` : String(iso);
  }

  /**
   * Date du jour (AAAA-MM-JJ) en heure LOCALE. `toISOString()` donnerait la date
   * UTC : à 00 h 30 à Paris (UTC+2), on enregistrerait la veille.
   */
  function todayISO(date = new Date()) {
    const p = (v) => String(v).padStart(2, "0");
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  /** Délai de relance appliqué à une candidature (0 = jamais de relance) */
  function followUpDelay(app) {
    if (NO_FOLLOWUP_STATUSES.includes(app && app.status)) return 0;
    return FOLLOWUP_DELAYS[app && app.status] ?? FOLLOWUP_DELAY_DEFAULT;
  }

  /**
   * Horodatage du dernier mouvement réel : dernier changement de statut
   * (statusHistory), sinon la date de démarche, sinon la création.
   * Une simple retouche de champ (updatedAt) ne remet donc pas le compteur à zéro.
   */
  function lastMoveAt(app) {
    let best = 0;
    const history = Array.isArray(app && app.statusHistory) ? app.statusHistory : [];
    for (const entry of history) {
      const at = Date.parse(entry && entry.at ? entry.at : "");
      if (!Number.isNaN(at) && at > best) best = at;
    }
    // Midi UTC : évite qu'un fuseau décalé fasse basculer la date d'un jour
    const demarche = Date.parse(`${(app && app.dateDemarche) || ""}T12:00:00.000Z`);
    if (!Number.isNaN(demarche) && demarche > best) best = demarche;
    if (!best) {
      const created = Date.parse((app && (app.createdAt || app.updatedAt)) || "");
      if (!Number.isNaN(created)) best = created;
    }
    return best;
  }

  /** Dernier statut connu (celui de l'historique s'il existe) */
  function lastStatus(app) {
    const history = Array.isArray(app && app.statusHistory) ? app.statusHistory : [];
    return (history[history.length - 1] || {}).status || (app && app.status) || "";
  }

  /** Jours écoulés depuis le dernier mouvement (changement de statut ou démarche) */
  function daysSinceActivity(app, { now = Date.now() } = {}) {
    const at = lastMoveAt(app);
    if (!at) return 0;
    return Math.max(0, Math.floor((now - at) / 86400000));
  }

  /**
   * Statut « relance » d'une candidature :
   *  - "due"    : prochaine action atteinte ou dépassée
   *  - "overdue": aucun mouvement depuis le délai prévu pour l'étape en cours
   *               (uniquement si aucune date de prochaine action n'est posée)
   */
  function followUpState(app, { now = new Date() } = {}) {
    const delay = followUpDelay(app);
    if (!delay) return "";
    // Une date de prochaine action fait foi : une valeur illisible est ignorée
    // plutôt que comparée comme du texte et déclarée due par accident.
    const nextAction = normalizeDay(app && app.nextAction);
    if (nextAction) return nextAction <= todayISO(now) ? "due" : "";
    return daysSinceActivity(app, { now: now.getTime() }) >= delay ? "overdue" : "";
  }

  // ---------- Ce que veulent dire « envoyée », « réponse », « entretien » ----------
  // Défini une seule fois, puis lu par les cartes de statistiques, les filtres
  // rapides, l'entonnoir, les exports et l'API : le même mot ne peut pas porter
  // deux chiffres selon l'endroit de l'écran qui l'affiche.

  /** Statuts qui valent un entretien ou une offre — l'étape positive de la démarche */
  const INTERVIEW_STATUSES = ["Entretien", "Offre reçue"];
  /** Statuts qui valent une réponse de l'employeur, positive ou négative */
  const RESPONSE_STATUSES = [...INTERVIEW_STATUSES, "Refus"];

  /**
   * La candidature a-t-elle été ENVOYÉE ? L'historique compte autant que le statut
   * courant : une candidature passée en « Entretien » puis remise « À postuler »
   * par un import a bien été envoyée. C'est cette définition — et elle seule — qui
   * alimente la carte « Envoyées », le filtre rapide et la première marche de
   * l'entonnoir.
   */
  function wasSent(app) {
    if (app && app.status !== "À postuler") return true;
    const history = Array.isArray(app && app.statusHistory) ? app.statusHistory : [];
    return history.some((entry) => entry && entry.status && entry.status !== "À postuler");
  }

  /**
   * Étapes réellement atteintes, d'après le statut courant ET l'historique : sans
   * ça, un entretien suivi d'un refus disparaîtrait de l'entonnoir.
   */
  function everReached(app, statuses) {
    if (statuses.includes(app && app.status)) return true;
    const history = Array.isArray(app && app.statusHistory) ? app.statusHistory : [];
    return history.some((entry) => entry && statuses.includes(entry.status));
  }

  /** Entretien ou offre EN COURS (statut actuel) : la carte du pipeline du jour */
  function hasInterview(app) {
    return INTERVIEW_STATUSES.includes(app && app.status);
  }

  /**
   * Filtres rapides des cartes de statistiques (et de `?quick=`) : chacun décrit
   * exactement la carte qu'il sert, donc le compte affiché est le nombre de lignes
   * obtenues en cliquant dessus.
   */
  const QUICK_FILTERS = {
    sent: wasSent,
    interview: hasInterview,
    refused: (a) => a.status === "Refus",
    followup: (a) => followUpState(a) !== "",
  };

  // ---------- Sélection : filtres, recherche, tri ----------
  // Écrite une seule fois. L'interface s'en sert pour afficher, le serveur pour
  // exporter : « exporter ce que je vois » n'est pas une promesse, c'est le même
  // code qui tourne des deux côtés.

  /** Texte dans lequel la recherche libre (q) trouve une candidature */
  function haystack(app) {
    return [
      app.company, app.position, app.status, app.type, app.location,
      app.postalCode, app.source, app.salary, app.contactName,
      app.contactEmail, app.contactPhone, app.notes,
    ].map((v) => String(v ?? "")).join(" ").toLowerCase();
  }

  /**
   * Valeur de tri d'un champ. Deux exceptions au tri alphabétique : les statuts et
   * les types suivent l'ordre logique du métier (pas l'alphabet), et certaines
   * colonnes (contact, relance) se trient sur une valeur calculée.
   */
  function sortValue(app, field) {
    if (field === "status") {
      const index = STATUSES.indexOf(app.status);
      return index < 0 ? Number.POSITIVE_INFINITY : index;
    }
    if (field === "type") {
      const index = TYPES.indexOf(app.type);
      return index < 0 ? Number.POSITIVE_INFINITY : index;
    }
    if (field === "contact") return String(app.contactName || app.contactPhone || app.contactEmail || "").toLowerCase();
    if (field === "nextAction") return app.nextAction || "9999-12-31";
    if (field === "dateDemarche") return app.dateDemarche || "9999-12-31";
    if (field === "lastMove") return lastMoveAt(app) || 0;
    if (field === "url") return String(app.url || "");
    return String(app[field] ?? "").toLowerCase();
  }

  /** Tris proposés dans la liste déroulante ("date-desc" = valeur par défaut) */
  const SORT_PRESETS = {
    "date-desc": (a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
    "date-asc": (a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")),
    demarche: (a, b) => String(b.dateDemarche || "").localeCompare(String(a.dateDemarche || "")),
    company: (a, b) => new Intl.Collator("fr", { sensitivity: "base", numeric: true }).compare(a.company || "", b.company || ""),
    status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status),
  };

  /**
   * Trie une COPIE de la liste. Sans tri demandé, l'ordre reçu est conservé (c'est
   * ce que fait l'API quand on ne lui passe ni `sort` ni `selectSort`).
   */
  function sortApps(list, { sort = "", dir = "asc", selectSort = "" } = {}) {
    const out = list.slice();
    const requestedSort = SORT_FIELDS.includes(sort) ? sort : "";
    if (requestedSort) {
      const sign = dir === "desc" ? -1 : 1;
      const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
      out.sort((a, b) => {
        const va = sortValue(a, sort);
        const vb = sortValue(b, sort);
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
        return collator.compare(String(va), String(vb)) * sign;
      });
      return out;
    }
    const preset = SELECT_SORTS.includes(selectSort) ? SORT_PRESETS[selectSort] : null;
    return preset ? out.sort(preset) : out;
  }

  /**
   * Normalise un booléen arrivé d'une URL (`?followup=true`) ou d'un objet JS.
   * `"false"` est faux, contrairement à ce que dirait un simple test de vérité.
   */
  function isOn(value) {
    return value === true || value === "true" || value === "1" || value === "on" || value === "yes";
  }

  // Dates filtrables : la plage « du … au … » porte sur la date de démarche par
  // défaut (c'est la date qui situe une candidature), ou sur la relance prévue.
  const DATE_FIELDS = ["dateDemarche", "nextAction"];
  const DATE_FIELD_LABELS = {
    dateDemarche: "date de démarche",
    nextAction: "prochaine action",
  };

  /**
   * « 2026-09-12 », « 2026-09-12T10:00:00Z » ou un objet Date → « 2026-09-12 ».
   * Renvoie "" si la valeur n'est pas une date exploitable : une date illisible ne
   * doit pas devenir « 1970 » et fausser silencieusement un filtre.
   */
  function normalizeDay(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : todayISO(value);
    const m = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    // Une date impossible (31/02, mois 13) est ignorée : sinon une borne absurde
    // viderait la liste sans explication. Le champ « date » du navigateur ne peut pas
    // en produire, mais une URL ou un agent si.
    const parsed = new Date(`${day}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) || todayISO(parsed) !== day ? "" : day;
  }

  /**
   * Libellé lisible d'une plage de dates : « du 01/09/2026 au 12/09/2026 »,
   * « à partir du 01/09/2026 », « jusqu'au 12/09/2026 », « le 12/09/2026 ».
   * Utilisé par le titre de la liste, l'en-tête du PDF et le nom du fichier.
   */
  function dateRangeLabel(from, to, dateField = DATE_FIELDS[0]) {
    const du = normalizeDay(from);
    const au = normalizeDay(to);
    if (!du && !au) return "";
    const prefix = dateField === "nextAction" ? "prochaine action " : "";
    if (du && au) {
      return du === au ? `${prefix}le ${fmtDateFR(du)}` : `${prefix}du ${fmtDateFR(du)} au ${fmtDateFR(au)}`;
    }
    return du ? `${prefix}à partir du ${fmtDateFR(du)}` : `${prefix}jusqu'au ${fmtDateFR(au)}`;
  }

  /**
   * Liste retenue par une sélection. Les paramètres arrivent aussi bien d'un objet
   * JS (interface) que d'une URL (`?status=Postulé&quick=followup`), d'où la
   * normalisation des booléens en texte.
   */
  function selectApps(list, params = {}) {
    const src = Array.isArray(list) ? list : [];
    const truthy = isOn;
    const status = String(params.status ?? "").trim();
    const type = String(params.type ?? "").trim();
    const company = String(params.company ?? "").trim().toLowerCase();
    const needle = String(params.q ?? "").trim().toLowerCase();
    const followup = truthy(params.followup);
    const quick = QUICK_FILTERS[params.quick] || null;
    // Plage de dates, bornes INCLUSES (filtrer « du 1er au 7 » inclut le 7, comme
    // un calendrier) ; les valeurs de date sont comparées en texte AAAA-MM-JJ.
    const dateField = DATE_FIELDS.includes(params.dateField) ? params.dateField : DATE_FIELDS[0];
    const from = normalizeDay(params.from);
    const to = normalizeDay(params.to);

    let out = src.filter((a) => {
      if (status && a.status !== status) return false;
      if (type && a.type !== type) return false;
      if (company && !String(a.company ?? "").toLowerCase().includes(company)) return false;
      if (followup && !followUpState(a)) return false;
      if (quick && !quick(a)) return false;
      if (needle && !haystack(a).includes(needle)) return false;
      if (from || to) {
        const day = normalizeDay(a[dateField]);
        // Sans date, impossible de situer la fiche dans la plage : elle sort de la
        // sélection (mieux vaut ça qu'inclure une fiche qu'on ne peut pas dater).
        if (!day) return false;
        if (from && day < from) return false;
        if (to && day > to) return false;
      }
      return true;
    });

    const sorted = sortApps(out, params);
    // Les paramètres HTTP et MCP annoncent un entier. Une valeur partielle
    // (`"2abc"`) ne doit pas être interprétée silencieusement comme `2`.
    const rawLimit = params.limit;
    const limit = rawLimit === undefined || rawLimit === null || rawLimit === ""
      ? NaN
      : Number(rawLimit);
    return Number.isInteger(limit) && limit > 0
      ? sorted.slice(0, Math.min(limit, 10000))
      : sorted;
  }

  /**
   * Chiffres du bandeau (écran) et des indicateurs du PDF : mêmes définitions
   * partout, sinon un export filtré annoncerait les totaux d'une autre liste.
   */
  function computeStats(list) {
    const apps = Array.isArray(list) ? list : [];
    const total = apps.length;
    // « Envoyées » : la même définition que le filtre rapide et que la première
    // marche de l'entonnoir — un mot, un chiffre.
    const sent = apps.filter(wasSent).length;
    // Le pipeline actuel : un entretien déjà passé puis refusé n'est plus « en
    // cours » (l'entonnoir, lui, garde la trace — voir `interviewsReached`).
    const interviews = apps.filter(hasInterview).length;
    const refused = apps.filter((a) => a.status === "Refus").length;
    const followUps = apps.filter((a) => followUpState(a)).length;
    // Taux de réponse = entretiens DÉJÀ obtenus ÷ envois : la carte mesure le
    // rendement de la recherche, pas la taille du pipeline du jour.
    const interviewsReached = apps.filter((a) => everReached(a, INTERVIEW_STATUSES)).length;
    return {
      total,
      sent,
      interviews,
      interviewsReached,
      refused,
      followUps,
      rate: sent ? Math.round((interviewsReached / sent) * 100) : 0,
    };
  }

  // ---------- Analyses de recherche d'emploi ----------
  // Ce que le tableau et les compteurs ne disent pas : quel canal répond, en
  // combien de temps, et jusqu'où mène une candidature. Tout est DÉDUIT de la liste
  // reçue (statut actuel + historique horodaté) : rien de plus à saisir.

  /** Premier horodatage d'une réponse de l'employeur ("" si l'historique n'en a pas) */
  function firstResponseAt(app) {
    const history = Array.isArray(app && app.statusHistory) ? app.statusHistory : [];
    for (const entry of history) {
      if (entry && RESPONSE_STATUSES.includes(entry.status)) return String(entry.at || "");
    }
    return "";
  }

  /** Nombre de jours entiers entre deux jours AAAA-MM-JJ (null si l'un est illisible) */
  function daysBetweenDays(from, to) {
    const start = normalizeDay(from);
    const end = normalizeDay(to);
    if (!start || !end) return null;
    return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000);
  }

  /** Jour de départ d'une candidature : date de démarche, sinon date de création */
  function appliedDay(app) {
    return normalizeDay((app && app.dateDemarche) || "") || String((app && app.createdAt) || "").slice(0, 10);
  }

  /**
   * Analyses : `sources` (par canal d'origine), `responseDelay` (jours avant la
   * première réponse) et `funnel` (envoyées → réponses → entretiens → offres).
   * Les candidatures jamais envoyées sont écartées : elles ne disent rien du rendement.
   */
  function computeInsights(list) {
    const apps = (Array.isArray(list) ? list : []).filter(wasSent);

    const bySource = new Map();
    for (const app of apps) {
      const label = String((app && app.source) || "").trim() || "Sans source";
      const row = bySource.get(label) || { label, sent: 0, responses: 0, interviews: 0 };
      row.sent += 1;
      if (everReached(app, RESPONSE_STATUSES)) row.responses += 1;
      if (everReached(app, INTERVIEW_STATUSES)) row.interviews += 1;
      bySource.set(label, row);
    }
    // Le canal le plus utilisé d'abord : c'est celui qui pèse sur la recherche
    const sources = [...bySource.values()]
      .map((row) => ({ ...row, rate: row.sent ? Math.round((row.responses / row.sent) * 100) : 0 }))
      .sort((a, b) => b.sent - a.sent || a.label.localeCompare(b.label, "fr"));

    // Délai moyen avant la première réponse : seules les candidatures dont
    // l'historique date une réponse comptent (un import sans historique ne peut pas
    // être daté — mieux vaut une moyenne sur trois cas qu'une moyenne inventée).
    const delays = [];
    for (const app of apps) {
      const answered = firstResponseAt(app);
      if (!answered) continue;
      const days = daysBetweenDays(appliedDay(app), answered);
      if (days !== null && days >= 0) delays.push(days);
    }
    const responseDelay = {
      count: delays.length,
      average: delays.length ? Math.round(delays.reduce((sum, days) => sum + days, 0) / delays.length) : 0,
    };

    const count = (statuses) => apps.filter((app) => everReached(app, statuses)).length;
    const funnel = [
      { key: "sent", label: "Envoyées", value: apps.length },
      { key: "responses", label: "Réponses", value: count(RESPONSE_STATUSES) },
      { key: "interviews", label: "Entretiens", value: count(INTERVIEW_STATUSES) },
      { key: "offers", label: "Offres", value: apps.filter((app) => everReached(app, ["Offre reçue"])).length },
    ];

    return { sources, responseDelay, funnel };
  }

  return {
    STATUSES,
    TYPES,
    STATUS_TONE,
    TYPE_TONE,
    NO_FOLLOWUP_STATUSES,
    FOLLOWUP_DELAYS,
    FOLLOWUP_DELAY_DEFAULT,
    fmtDateFR,
    todayISO,
    followUpDelay,
    lastMoveAt,
    lastStatus,
    daysSinceActivity,
    followUpState,
    QUICK_FILTERS,
    SORT_FIELDS,
    SELECT_SORTS,
    isOn,
    DATE_FIELDS,
    DATE_FIELD_LABELS,
    normalizeDay,
    dateRangeLabel,
    haystack,
    sortValue,
    SORT_PRESETS,
    sortApps,
    selectApps,
    computeStats,
    INTERVIEW_STATUSES,
    RESPONSE_STATUSES,
    wasSent,
    everReached,
    hasInterview,
    firstResponseAt,
    daysBetweenDays,
    computeInsights,
  };
});
