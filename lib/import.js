// Import d'un fichier de candidatures (JSON : tableau, export complet, ou fiche
// seule). Deux modes, une seule transaction chacun : `merge` ajoute ce qui manque,
// `replace` écrase tout — mais jamais sans avoir copié la base au préalable.
const { IMPORT_MODES } = require("./api-contract");
const { getDb, readApplications, nextOrder, INSERT_SQL, applicationParams } = require("./sqlite");
const { writeCover } = require("./cover");
const { requireSnapshot } = require("./backups");
const { normalizeImportedItem } = require("./model");
const { ValidationError } = require("./errors");

function insertApplications(database, apps) {
  const insert = database.prepare(INSERT_SQL);
  apps.forEach((app, index) => insert.run(applicationParams(app, index)));
}

function importApplications(payload, { mode = "merge" } = {}) {
  if (!IMPORT_MODES.includes(mode)) throw new ValidationError("Mode d'import invalide : utilisez merge ou replace.");

  const items = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.applications)
      ? payload.applications
      : payload && typeof payload === "object"
        ? [payload]
        : [];
  if (!items.length) {
    throw new ValidationError("Aucune candidature trouvée dans le fichier. Format attendu : un tableau de candidatures ou un export de cette application.");
  }

  const cover = !Array.isArray(payload) && payload && typeof payload.cover === "object" && payload.cover
    ? payload.cover
    : null;
  const cleaned = [];
  const invalid = [];
  for (const [index, raw] of items.entries()) {
    const result = normalizeImportedItem(raw);
    if (result.errors) invalid.push(`Élément #${index + 1} : ${result.errors.join(" ")}`);
    else cleaned.push(result);
  }

  if (!cleaned.length) {
    if (mode === "replace") throw new ValidationError("Aucune candidature valide à importer : les données existantes sont conservées.");
    return { mode, added: 0, skipped: 0, invalid, total: readApplications().length, cover: false, backup: "" };
  }

  const unique = [];
  const seen = new Set();
  let skipped = 0;
  for (const item of cleaned) {
    if (seen.has(item.id)) {
      skipped += 1;
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }

  const database = getDb();
  let backup = "";
  if (mode === "replace") {
    backup = requireSnapshot("avant un import en remplacement");
    database.transaction(() => {
      database.exec("DELETE FROM applications");
      insertApplications(database, unique);
      if (cover) writeCover(database, cover);
    })();
    return { mode, added: unique.length, skipped, invalid, total: unique.length, cover: Boolean(cover), backup };
  }

  const existingIds = new Set(readApplications().map((app) => app.id));
  let added = 0;
  database.transaction(() => {
    for (const item of unique) {
      if (existingIds.has(item.id)) {
        skipped += 1;
        continue;
      }
      database.prepare(INSERT_SQL).run(applicationParams(item, nextOrder(database)));
      existingIds.add(item.id);
      added += 1;
    }
    if (cover) writeCover(database, cover);
  })();

  return { mode, added, skipped, invalid, total: readApplications().length, cover: Boolean(cover), backup: "" };
}

module.exports = { importApplications };
