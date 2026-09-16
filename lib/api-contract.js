// Contrat partagé de l'API REST et des outils de sélection.
// Le serveur HTTP, le catalogue, OpenAPI et MCP consomment ce module : une route
// ou un filtre ne doit pas être documenté à plusieurs endroits.
const rules = require("./rules");

const FILTER_DEFS = Object.freeze({
  status: { type: "string", enum: rules.STATUSES, description: "Filtre par statut (ex. « À postuler »)" },
  type: { type: "string", enum: rules.TYPES, description: "Filtre par type de contrat (CDI, Alternance…)" },
  company: { type: "string", description: "Filtre par nom d'entreprise (contient)" },
  q: { type: "string", description: "Recherche plein texte dans les champs visibles et les coordonnées" },
  followup: { type: "boolean", description: "true : uniquement les candidatures à relancer" },
  quick: { type: "string", enum: Object.keys(rules.QUICK_FILTERS), description: "Filtre rapide : sent | interview | refused | followup" },
  from: { type: "string", description: "Date de début, incluse (AAAA-MM-JJ)" },
  to: { type: "string", description: "Date de fin, incluse (AAAA-MM-JJ)" },
  dateField: { type: "string", enum: rules.DATE_FIELDS, description: "Date de la plage : dateDemarche (défaut) ou nextAction" },
  sort: { type: "string", enum: rules.SORT_FIELDS, description: "Colonne de tri (company, status, dateDemarche, nextAction…)" },
  dir: { type: "string", enum: ["asc", "desc"], description: "Sens du tri (asc par défaut)" },
  selectSort: { type: "string", enum: rules.SELECT_SORTS, description: "Tri prédéfini de l'interface (date-desc par défaut)" },
  limit: { type: "integer", minimum: 0, maximum: 10000, description: "Nombre maximum de lignes (0 = sans limite)" },
});

const BODY_APPLICATION_CREATE = {
  required: ["company", "position"],
  optional: ["status", "type", "dateDemarche", "nextAction", "postalCode", "location", "source", "salary", "url", "contactName", "contactEmail", "contactPhone", "notes"],
};

function cloneDefinition(definition) {
  return {
    type: definition.type,
    ...(definition.enum ? { enum: [...definition.enum] } : {}),
    ...(definition.format ? { format: definition.format } : {}),
    ...(definition.minimum === undefined ? {} : { minimum: definition.minimum }),
    ...(definition.maximum === undefined ? {} : { maximum: definition.maximum }),
    ...(definition.default === undefined ? {} : { default: definition.default }),
    description: definition.description,
  };
}

function fieldSchema(field) {
  const isDate = field.type === "date";
  const isEmail = field.type === "email";
  const hint = isDate && !field.desc.includes("YYYY-MM-DD") ? " (YYYY-MM-DD ou JJ/MM/AAAA)" : "";
  return {
    type: isDate || isEmail ? "string" : field.type,
    ...(isDate ? { format: "date" } : isEmail ? { format: "email" } : {}),
    description: field.desc + hint,
    ...(field.enum ? { enum: [...field.enum] } : {}),
  };
}

function applicationProperties(fields) {
  return Object.fromEntries(fields.map((field) => [field.name, fieldSchema(field)]));
}

function applicationSchema(fields, required = []) {
  return {
    type: "object",
    ...(required.length ? { required: [...required] } : {}),
    properties: applicationProperties(fields),
  };
}

function filterProperties() {
  return Object.fromEntries(Object.entries(FILTER_DEFS).map(([name, definition]) => [name, cloneDefinition(definition)]));
}

function filterParameters() {
  return Object.entries(FILTER_DEFS).map(([name, definition]) => ({
    name,
    in: "query",
    required: false,
    schema: cloneDefinition(definition),
  }));
}

function filterDescriptions() {
  return Object.fromEntries(Object.entries(FILTER_DEFS).map(([name, definition]) => [name, definition.description]));
}

const IMPORT_MODES = ["merge", "replace"];
const BOOLEAN_QUERY_VALUES = new Set(["true", "false", "1", "0", "on", "off", "yes", "no"]);

/**
 * Valide les paramètres de sélection avant de les transmettre aux règles métier.
 * Les bornes de dates invalides restent volontairement tolérées : `rules.selectApps`
 * les ignore conformément au contrat historique de l'interface. Les paramètres de
 * vocabulaire, eux, sont rejetés : une faute de frappe ne doit pas exporter tout le
 * suivi en silence.
 */
function validateSelectionParams(params = {}) {
  const errors = [];
  const value = (name) => params[name] === undefined || params[name] === null ? "" : String(params[name]).trim();
  const enumError = (name, allowed) => {
    const current = value(name);
    if (current && !allowed.includes(current)) errors.push(`Paramètre « ${name} » invalide « ${current} ». Valeurs possibles : ${allowed.join(", ")}.`);
  };

  enumError("status", rules.STATUSES);
  enumError("type", rules.TYPES);
  enumError("quick", Object.keys(rules.QUICK_FILTERS));
  enumError("dateField", rules.DATE_FIELDS);
  enumError("sort", rules.SORT_FIELDS);
  enumError("dir", ["asc", "desc"]);
  enumError("selectSort", rules.SELECT_SORTS);

  if (params.followup !== undefined && params.followup !== null && value("followup") &&
      typeof params.followup !== "boolean" && !BOOLEAN_QUERY_VALUES.has(value("followup").toLowerCase())) {
    errors.push("Paramètre « followup » invalide : utilisez true/false.");
  }

  const rawLimit = value("limit");
  if (rawLimit && (!/^\d+$/.test(rawLimit) || Number(rawLimit) > 10000)) {
    errors.push("Paramètre « limit » invalide : utilisez un entier compris entre 0 et 10000.");
  }
  return errors;
}

function validateImportMode(mode) {
  return mode === undefined || mode === "" || IMPORT_MODES.includes(mode);
}

/**
 * Ce que contiennent les analyses et les instantanés — écrit une fois, servi aux
 * deux exécutants : GET /api/schema et l'outil MCP `get_schema` décrivent donc
 * exactement la même chose à un agent, quel que soit le transport qu'il parle.
 */
const SHARED_SECTIONS = Object.freeze({
  insights: {
    where: "GET /api/dashboard → `insights`",
    sources: "par canal d'origine : { label, sent, responses, interviews, rate } — triés par volume d'envois, « Sans source » pour les fiches sans source",
    responseDelay: "{ count, average } — jours entiers entre la démarche et la première réponse ; seules les fiches dont l'historique date une réponse comptent",
    funnel: "[{ key, label, value }] — envoyées → réponses → entretiens → offres : étapes ATTEINTES, historique compris (un entretien suivi d'un refus reste compté)",
    definitions: {
      sent: "au moins un envoi : statut autre que « À postuler », ou historique qui en témoigne",
      responses: "entretien, offre ou refus atteint",
      interviews: "entretien ou offre atteint (la carte « En cours » du tableau de bord, elle, ne compte que le statut actuel)",
    },
  },
  backups: {
    when: "à chaque démarrage où la base a bougé, et avant toute opération destructrice (suppression, import en remplacement)",
    restore: "POST /api/backups/restore { name } — l'état écrasé est copié avant : une restauration est elle-même réversible",
    refused: "si l'instantané de sécurité ne peut pas être écrit, l'opération est refusée avec un message explicite plutôt que faite sans filet",
  },
});

const API_ROUTE_DEFS = Object.freeze([
  { path: "/api", methods: ["GET"], description: "Ce catalogue (documentation vivante)" },
  { path: "/api/applications", methods: ["GET"], description: "Lister les candidatures", query: filterDescriptions() },
  { path: "/api/applications", methods: ["POST"], description: "Créer une candidature", body: BODY_APPLICATION_CREATE },
  { path: "/api/applications/{id}", pattern: /^\/api\/applications\/([^/]+)$/, methods: ["GET", "PUT", "PATCH", "DELETE"], description: "Récupérer, modifier ou supprimer une candidature par son id" },
  { path: "/api/applications/{id}/status", pattern: /^\/api\/applications\/([^/]+)\/status$/, methods: ["POST"], description: "Changer uniquement le statut, body { \"status\": \"Postulé\" }" },
  { path: "/api/export", methods: ["GET"], description: "Exporter tout le suivi en JSON (sauvegarde complète, candidatures + page de garde)" },
  { path: "/api/export/csv", methods: ["GET"], description: "Exporter en CSV (« ; », BOM UTF-8, prêt pour Excel)", query: filterDescriptions() },
  { path: "/api/export/pdf", methods: ["GET"], description: "Exporter en PDF (tableau A4 paysage, mêmes filtres que l'interface)", query: filterDescriptions() },
  { path: "/api/import", methods: ["POST"], description: "Importer des candidatures en JSON (mode merge ou replace)" },
  { path: "/api/cover", methods: ["GET", "PUT", "PATCH"], description: "Lire ou modifier la page de garde du PDF" },
  { path: "/api/stats", methods: ["GET"], description: "Statistiques du suivi" },
  { path: "/api/dashboard", methods: ["GET"], description: "Dashboard : séries mensuelles, répartitions, et analyses (`insights`)" },
  { path: "/api/backups", methods: ["GET", "POST"], description: "Lister ou créer un instantané de sécurité" },
  { path: "/api/backups/restore", methods: ["POST"], description: "Restaurer un instantané nommé" },
  { path: "/api/openapi.json", methods: ["GET"], description: "Spécification OpenAPI 3.1 complète" },
  { path: "/api/schema", methods: ["GET"], description: "Schéma des champs et valeurs possibles" },
]);

function routeMatches(route, pathname) {
  if (!route.pattern) return route.path === pathname;
  const match = pathname.match(route.pattern);
  if (!match) return false;
  try {
    decodeURIComponent(match[1]);
    return true;
  } catch {
    return false;
  }
}

function apiMethods(pathname) {
  const matches = API_ROUTE_DEFS.filter((route) => routeMatches(route, pathname));
  if (!matches.length) return null;
  return [...new Set(matches.flatMap((route) => route.methods))];
}

function catalogEndpoints() {
  return API_ROUTE_DEFS.flatMap((route) => route.methods.map((method) => ({
    method,
    path: route.path,
    description: route.description,
    ...(route.query ? { query: route.query } : {}),
    ...(route.body ? { body: route.body } : {}),
  })));
}

function pathIdParameter() {
  return { name: "id", in: "path", required: true, schema: { type: "string" } };
}

function jsonResponse(description, schema) {
  return {
    description,
    ...(schema ? { content: { "application/json": { schema } } } : {}),
  };
}

function openApiPaths(fields) {
  const createSchema = applicationSchema(fields, ["company", "position"]);
  const patchSchema = applicationSchema(fields);
  const statusSchema = { type: "object", required: ["status"], properties: { status: { type: "string", enum: [...rules.STATUSES] } } };
  const coverSchema = {
    type: "object",
    properties: {
      enabled: { type: "boolean", description: "Ajouter une page de garde" },
      title: { type: "string", maxLength: 120 },
      subtitle: { type: "string", maxLength: 200 },
      text: { type: "string", maxLength: 4000 },
      showStats: { type: "boolean", description: "Afficher les indicateurs" },
    },
  };
  const applicationExportSchema = {
    type: "object",
    required: ["applications"],
    properties: {
      exportVersion: { type: "integer" },
      exportedAt: { type: "string", format: "date-time" },
      count: { type: "integer" },
      applications: { type: "array", items: createSchema },
      cover: coverSchema,
    },
  };
  const jsonBody = (schema, required = true) => ({ required, content: { "application/json": { schema } } });
  const operation = (summary, responses, extra = {}) => ({ summary, responses, ...extra });

  return {
    "/api": {
      get: operation("Catalogue de l'API", { "200": jsonResponse("Catalogue des routes, champs et enums") }),
    },
    "/api/applications": {
      get: operation("Lister les candidatures", { "200": jsonResponse("Liste des candidatures") }, { parameters: filterParameters() }),
      post: operation("Créer une candidature", { "201": jsonResponse("Candidature créée", createSchema), "400": { description: "Validation échouée" } }, { requestBody: jsonBody(createSchema) }),
    },
    "/api/applications/{id}": {
      get: operation("Récupérer une candidature", { "200": jsonResponse("La candidature", createSchema), "404": { description: "Introuvable" } }, { parameters: [pathIdParameter()] }),
      put: operation("Modifier une candidature (fusion)", { "200": jsonResponse("Candidature mise à jour", createSchema), "400": { description: "Validation échouée" }, "404": { description: "Introuvable" } }, { parameters: [pathIdParameter()], requestBody: jsonBody(patchSchema) }),
      patch: operation("Modifier des champs précis", { "200": jsonResponse("Candidature mise à jour", createSchema), "400": { description: "Validation échouée" }, "404": { description: "Introuvable" } }, { parameters: [pathIdParameter()], requestBody: jsonBody(patchSchema) }),
      delete: operation("Supprimer une candidature", { "200": jsonResponse("Candidature supprimée"), "404": { description: "Introuvable" } }, { parameters: [pathIdParameter()] }),
    },
    "/api/applications/{id}/status": {
      post: operation("Changer uniquement le statut", { "200": jsonResponse("Statut mis à jour", createSchema), "400": { description: "Statut invalide" }, "404": { description: "Introuvable" } }, { parameters: [pathIdParameter()], requestBody: jsonBody(statusSchema) }),
    },
    "/api/export": {
      get: operation(
        "Exporter tout le suivi en JSON",
        { "200": { description: "Sauvegarde complète", content: { "application/json": { schema: applicationExportSchema } } } }
      ),
    },
    "/api/export/csv": {
      get: operation("Exporter en CSV", { "200": { description: "Fichier CSV", content: { "text/csv": { schema: { type: "string" } } } } }, { parameters: filterParameters() }),
    },
    "/api/export/pdf": {
      get: operation("Exporter en PDF", { "200": { description: "Fichier PDF", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } } }, { parameters: filterParameters() }),
    },
    "/api/import": {
      post: operation("Importer des candidatures", { "200": { description: "Résumé de l'import" }, "400": { description: "JSON vide, invalide ou données non valides" } }, { parameters: [{ name: "mode", in: "query", required: false, schema: { type: "string", enum: ["merge", "replace"], default: "merge" } }], requestBody: jsonBody({ oneOf: [createSchema, { type: "array", items: createSchema }, { type: "object", properties: { applications: { type: "array", items: createSchema }, cover: coverSchema } } ] }) }),
    },
    "/api/cover": {
      get: operation("Lire la page de garde", { "200": jsonResponse("Page de garde", coverSchema) }),
      put: operation("Modifier la page de garde", { "200": jsonResponse("Page de garde enregistrée", coverSchema) }, { requestBody: jsonBody(coverSchema) }),
      patch: operation("Modifier la page de garde", { "200": jsonResponse("Page de garde enregistrée", coverSchema) }, { requestBody: jsonBody(coverSchema) }),
    },
    "/api/stats": { get: operation("Statistiques", { "200": jsonResponse("Statistiques du suivi") }) },
    "/api/dashboard": { get: operation("Données du dashboard", { "200": jsonResponse("Séries temporelles et analyses") }) },
    "/api/backups": {
      get: operation("Lister les instantanés", { "200": jsonResponse("Instantanés disponibles") }),
      post: operation("Créer un instantané", { "201": jsonResponse("Instantané créé") }),
    },
    "/api/backups/restore": {
      post: operation("Restaurer un instantané", { "200": jsonResponse("Instantané restauré"), "400": { description: "Instantané illisible ou nom invalide" }, "404": { description: "Instantané introuvable" } }, { requestBody: jsonBody({ type: "object", required: ["name"], properties: { name: { type: "string" } } }) }),
    },
    "/api/openapi.json": { get: operation("Spécification OpenAPI", { "200": { description: "Document OpenAPI 3.1" } }) },
    "/api/schema": { get: operation("Schéma métier", { "200": jsonResponse("Champs, enums et règles de relance") }) },
  };
}

module.exports = {
  applicationProperties,
  applicationSchema,
  fieldSchema,
  filterProperties,
  filterParameters,
  filterDescriptions,
  validateSelectionParams,
  validateImportMode,
  IMPORT_MODES,
  catalogEndpoints,
  apiMethods,
  openApiPaths,
  API_ROUTE_DEFS,
  SHARED_SECTIONS,
};
