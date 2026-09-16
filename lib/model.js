// Le modèle d'une candidature : normalisation (casse, dates, coordonnées héritées)
// et validation. Aucune dépendance à SQLite ni au transport — ce module ne
// manipule que des objets, ce qui permet de le tester et de le réutiliser pour
// l'import, l'export et les écritures unitaires.
const { randomUUID } = require("crypto");
const { STATUSES, TYPES, DATE_FIELDS, todayISO } = require("./rules");
const { FIELD_DEFS, FIELD_LIMITS } = require("./fields");
const { ValidationError } = require("./errors");

const EMAIL_RE_VALID = /^[^\s@<>()[\]{},;]+@[^\s@<>()[\]{},;]+\.[^\s@<>()[\]{},;]+$/;
const EMAIL_RE = /[^\s@<>()[\]{},;]+@[^\s@<>()[\]{},;]+/g;
const EDGES_RE = /^[\s\-–—/|·,;.]+|[\s\-–—/|·,;.]+$/g;

/** L'identifiant d'une candidature — créé ici, au moment où la fiche est construite */
function makeId() {
  return randomUUID();
}

function normalizeDate(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;

  match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return match
    ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`
    : value;
}

function isValidDateValue(value) {
  const day = normalizeDate(value);
  if (!day) return true;
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const date = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

function isValidTimestamp(value) {
  return typeof value === "string" && value.length <= 100 && !Number.isNaN(Date.parse(value));
}

function migrateLegacyContact(app) {
  if (app.contact === undefined) return;

  const value = String(app.contact ?? "").trim();
  if (value && !app.contactEmail) app.contactEmail = value;
  if (value && !app.contactName) {
    const match = value.split("@")[0].match(/^([a-z]+)\.([a-z]+)/i);
    if (match) {
      const first = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
      const last = match[2][0].toUpperCase() + match[2].slice(1).toLowerCase();
      app.contactName = `${first} ${last}`;
    }
  }
  delete app.contact;
}

function looksLikePhone(value) {
  const text = String(value ?? "").trim();
  return Boolean(
    text
    && !text.includes("@")
    && /^\+?[\d\s().\-/]+$/.test(text)
    && (text.match(/\d/g) || []).length >= 8
  );
}

function splitContactFields(app) {
  const raw = String(app.contactEmail ?? "").trim();
  if (!raw) return;

  const emails = (raw.match(EMAIL_RE) || []).map((email) => email.replace(EDGES_RE, ""));
  if (emails.length > 1) return;

  const email = emails[0] || "";
  const rest = (email ? raw.replace(email, " ") : raw).replace(EDGES_RE, "").trim();
  if (!rest) {
    app.contactEmail = email;
    return;
  }
  if (!looksLikePhone(rest)) return;

  const existingPhone = String(app.contactPhone ?? "").trim();
  if (existingPhone && existingPhone !== rest) return;
  app.contactPhone = existingPhone || rest;
  app.contactEmail = email;
}

/**
 * Met à jour les coordonnées d'une fiche modifiée : ancien champ « contact »
 * fourni par l'appelant, puis partage entre e-mail et téléphone. L'ordre compte,
 * et c'est le même que celui d'un import — une seule façon de ranger un contact.
 */
function applyContactMigrations(app, sourceContact) {
  if (sourceContact !== undefined) {
    app.contact = sourceContact;
    migrateLegacyContact(app);
  }
  splitContactFields(app);
}

/** Tous les manquements d'une fiche déjà normalisée, pour les refuser d'un bloc */
function validate(app) {
  const errors = [];
  if (!String(app.company ?? "").trim()) errors.push("Le champ « Entreprise » (company) est obligatoire.");
  if (!String(app.position ?? "").trim()) errors.push("Le champ « Poste » (position) est obligatoire.");
  if (app.status && !STATUSES.includes(app.status)) {
    errors.push(`Statut invalide « ${app.status} ». Valeurs possibles : ${STATUSES.join(", ")}.`);
  }
  if (app.type && !TYPES.includes(app.type)) {
    errors.push(`Type invalide « ${app.type} ». Valeurs possibles : ${TYPES.join(", ")}.`);
  }
  for (const [field, maximum] of Object.entries(FIELD_LIMITS)) {
    if (String(app[field] ?? "").length > maximum) errors.push(`Le champ « ${field} » dépasse ${maximum} caractères.`);
  }
  for (const field of DATE_FIELDS) {
    if (app[field] && !isValidDateValue(app[field])) errors.push(`Le champ « ${field} » contient une date invalide.`);
  }
  if (app.contactEmail && !EMAIL_RE_VALID.test(String(app.contactEmail))) {
    errors.push("Le champ « contactEmail » contient une adresse e-mail invalide.");
  }
  if (app.url) {
    try {
      if (!["http:", "https:"].includes(new URL(String(app.url)).protocol)) throw new Error("protocole");
    } catch {
      errors.push("Le champ « url » doit être une URL http:// ou https:// valide.");
    }
  }
  return errors;
}

function normalizeApp(input, existing = {}, { strict = false } = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const app = {};

  for (const field of FIELD_DEFS) {
    const value = source[field.name];
    if (value === undefined) {
      app[field.name] = existing[field.name] ?? (field.name === "type" ? "CDI" : "");
    } else if (field.type === "date") {
      app[field.name] = normalizeDate(value);
    } else {
      app[field.name] = String(value ?? "").trim();
    }
  }

  if (!app.dateDemarche && source.dateDemarche === undefined && !existing.dateDemarche) {
    app.dateDemarche = todayISO();
  }

  if (app.status) {
    const match = STATUSES.find((status) => status.toLowerCase() === app.status.toLowerCase());
    if (match) app.status = match;
    else if (strict) throw new ValidationError(`Statut invalide « ${app.status} ». Valeurs possibles : ${STATUSES.join(", ")}.`);
  } else {
    app.status = existing.status ?? "À postuler";
  }

  if (app.type) {
    const match = TYPES.find((type) => type.toLowerCase() === app.type.toLowerCase());
    if (match) app.type = match;
    else if (strict) throw new ValidationError(`Type invalide « ${app.type} ». Valeurs possibles : ${TYPES.join(", ")}.`);
  }

  if (source.contact !== undefined) {
    const legacy = {
      contact: source.contact,
      contactEmail: app.contactEmail,
      contactName: app.contactName,
    };
    migrateLegacyContact(legacy);
    if (!app.contactEmail) app.contactEmail = legacy.contactEmail || "";
    if (!app.contactName) app.contactName = legacy.contactName || "";
  }

  splitContactFields(app);
  app.updatedAt = new Date().toISOString();
  return app;
}

/** Valeur d'un champ de PATCH : une date garde sa forme canonique, le reste est du texte */
function normalizePatchValue(name, value) {
  return DATE_FIELDS.includes(name) ? normalizeDate(value) : String(value ?? "").trim();
}

/**
 * Une fiche relue de la base (ou d'un fichier d'un autre outil) passe par les
 * migrations : ancien champ « contact », numéro rangé dans l'e-mail, date au
 * format `JJ/MM/AAAA`. L'ordre est significatif — la migration du contact doit
 * précéder le partage des coordonnées.
 */
function withMigrations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const app = { ...value };
  if (app.contact !== undefined) migrateLegacyContact(app);
  splitContactFields(app);
  if (app.dateDemarche !== undefined) app.dateDemarche = normalizeDate(app.dateDemarche);
  else if (app.createdAt) app.dateDemarche = String(app.createdAt).slice(0, 10);
  return app;
}

function normalizeHistory(rawHistory) {
  if (rawHistory === undefined) return { history: undefined, errors: [] };
  if (!Array.isArray(rawHistory)) return { history: undefined, errors: ["statusHistory doit être un tableau."] };

  const errors = [];
  const history = [];
  rawHistory.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`statusHistory[${index}] doit être un objet.`);
      return;
    }
    const status = String(entry.status ?? "").trim();
    const match = STATUSES.find((allowed) => allowed.toLowerCase() === status.toLowerCase());
    if (!match) {
      errors.push(`statusHistory[${index}] contient un statut invalide « ${status} ».`);
      return;
    }
    if (!isValidTimestamp(entry.at)) {
      errors.push(`statusHistory[${index}] contient une date invalide.`);
      return;
    }
    history.push({ status: match, at: entry.at });
  });

  // `lastStatus()` considère la dernière entrée comme la plus récente. Rendre
  // l'ordre explicite évite qu'un export produit par un autre outil fausse le
  // statut affiché lorsque son historique n'était pas trié.
  history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { history: history.slice(-100), errors };
}

/** Une fiche venue d'un fichier : normalisée, validée, ou refusée avec ses raisons */
function normalizeImportedItem(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: ["format invalide (objet attendu)"] };
  }

  try {
    const app = normalizeApp(raw, {}, { strict: true });
    const normalizedHistory = normalizeHistory(raw.statusHistory);
    const errors = [...normalizedHistory.errors, ...validate(app)];
    if (errors.length) return { errors };

    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : makeId();
    if (id.length > 200) return { errors: ["identifiant trop long (200 caractères maximum)"] };

    const now = new Date().toISOString();
    return {
      id,
      ...app,
      ...(normalizedHistory.history?.length ? { statusHistory: normalizedHistory.history } : {}),
      createdAt: isValidTimestamp(raw.createdAt) ? raw.createdAt : now,
      updatedAt: isValidTimestamp(raw.updatedAt) ? raw.updatedAt : app.updatedAt || now,
    };
  } catch (error) {
    return { errors: [error.message] };
  }
}

module.exports = {
  makeId,
  withMigrations,
  applyContactMigrations,
  normalizeApp,
  normalizePatchValue,
  normalizeImportedItem,
  validate,
};
