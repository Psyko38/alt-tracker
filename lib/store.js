// Les opérations sur les candidatures : créer, lire, modifier, supprimer, lister.
// C'est ici que passent les règles d'écriture — normalisation, historique de
// statut, ordre d'affichage — et la garantie qu'une suppression reste réversible.
//
// Ce que ce module ne fait plus : la connexion et le schéma de la base
// (lib/sqlite.js), la normalisation et la validation (lib/model.js), les
// instantanés (lib/backups.js), la page de garde (lib/cover.js), l'import
// (lib/import.js) et les statistiques (lib/stats.js). Les consommateurs
// importent chacun de ces modules directement.
const { getDb, readApplications, countApplications, INSERT_SQL, applicationParams } = require("./sqlite");
const { STATUSES, TYPES, DATE_FIELDS, selectApps } = require("./rules");
const { STRING_FIELDS } = require("./fields");
const { makeId, normalizeApp, normalizePatchValue, applyContactMigrations, validate } = require("./model");
const { requireSnapshot } = require("./backups");
const { ValidationError, NotFoundError } = require("./errors");

function createApplication(input) {
  const app = normalizeApp(input, {}, { strict: true });
  const errors = validate(app);
  if (errors.length) throw new ValidationError(errors.join(" "));

  const item = { id: makeId(), ...app, createdAt: new Date().toISOString() };
  const database = getDb();
  database.transaction(() => {
    database.prepare("UPDATE applications SET sort_order = sort_order + 1").run();
    database.prepare(INSERT_SQL).run(applicationParams(item, 0));
  })();
  return item;
}

function getApplication(id) {
  return readApplications().find((app) => app.id === id) || null;
}

function updateApplication(id, input) {
  const current = getApplication(id);
  if (!current) throw new NotFoundError();
  return patchApplication(id, normalizeApp(input, current, { strict: true }));
}

function patchApplication(id, patch, { strict = true } = {}) {
  const database = getDb();
  const current = getApplication(id);
  if (!current) throw new NotFoundError();

  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const merged = { ...current };
  for (const name of [...STRING_FIELDS, ...DATE_FIELDS]) {
    if (source[name] !== undefined) merged[name] = normalizePatchValue(name, source[name]);
  }

  if (merged.status) {
    const match = STATUSES.find((status) => status.toLowerCase() === String(merged.status).toLowerCase());
    if (match) merged.status = match;
    else if (strict && source.status !== undefined) {
      throw new ValidationError(`Statut invalide « ${merged.status} ». Valeurs possibles : ${STATUSES.join(", ")}.`);
    }
  }
  if (merged.type) {
    const match = TYPES.find((type) => type.toLowerCase() === String(merged.type).toLowerCase());
    if (match) merged.type = match;
    else if (strict && source.type !== undefined) {
      throw new ValidationError(`Type invalide « ${merged.type} ». Valeurs possibles : ${TYPES.join(", ")}.`);
    }
  }

  applyContactMigrations(merged, source.contact);

  const errors = validate(merged);
  if (errors.length) throw new ValidationError(errors.join(" "));

  const updatedAt = new Date().toISOString();
  merged.updatedAt = updatedAt;
  if (source.status !== undefined && merged.status !== current.status) {
    merged.statusHistory = [
      ...(Array.isArray(current.statusHistory) ? current.statusHistory : []),
      { status: merged.status, at: updatedAt },
    ].slice(-100);
  }

  const row = database.prepare("SELECT sort_order FROM applications WHERE id = ?").get(id);
  if (!row) throw new NotFoundError();
  database.prepare(`
    UPDATE applications SET
      company = @company,
      position = @position,
      status = @status,
      type = @type,
      date_demarche = @date_demarche,
      postal_code = @postal_code,
      location = @location,
      source = @source,
      salary = @salary,
      url = @url,
      contact_name = @contact_name,
      contact_email = @contact_email,
      contact_phone = @contact_phone,
      next_action = @next_action,
      notes = @notes,
      status_history = @status_history,
      updated_at = @updated_at,
      sort_order = @sort_order
    WHERE id = @id
  `).run({ ...applicationParams(merged, row.sort_order), updated_at: updatedAt });
  return merged;
}

// Une suppression est définitive : la base est copiée juste avant la disparition
// de la ligne, pour pouvoir revenir en arrière depuis data/backups/.
function deleteApplication(id) {
  const database = getDb();
  if (!getApplication(id)) throw new NotFoundError();
  requireSnapshot("avant une suppression");
  database.prepare("DELETE FROM applications WHERE id = ?").run(id);
  return { ok: true };
}

function deleteApplications(ids) {
  const requested = Array.isArray(ids) ? [...new Set(ids.map((id) => String(id)))] : [];
  if (!requested.length) return { removed: 0, total: readApplications().length };

  const database = getDb();
  const placeholders = requested.map(() => "?").join(",");
  const existing = database
    .prepare(`SELECT id FROM applications WHERE id IN (${placeholders})`)
    .all(...requested)
    .map((row) => row.id);
  if (!existing.length) return { removed: 0, total: readApplications().length };

  requireSnapshot("avant une suppression en masse");
  const result = database
    .prepare(`DELETE FROM applications WHERE id IN (${existing.map(() => "?").join(",")})`)
    .run(...existing);
  return { removed: result.changes, total: countApplications(database) };
}

function listApplications(filters = {}) {
  return selectApps(readApplications(), filters);
}

module.exports = {
  createApplication,
  getApplication,
  updateApplication,
  patchApplication,
  deleteApplication,
  deleteApplications,
  listApplications,
};
