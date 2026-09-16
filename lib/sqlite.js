// La base SQLite : le fichier, la connexion, le schéma, et la traduction d'une
// candidature en ligne SQL (et retour). SQLite est l'unique source de vérité.
// La migration de l'ancien JSON est volontaire et externe :
// `node scripts/migrate-json.js chemin/vers/applications.json`.
//
// C'est la seule porte vers la base : tout ce qui lit ou écrit passe par ce
// module, qui ne connaît ni les opérations métier (lib/store.js), ni les
// instantanés (lib/backups.js), ni le transport.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { withMigrations } = require("./model");

const DB_FILE = process.env.JOB_TRACKER_DB_FILE || path.join(__dirname, "..", "data", "applications.sqlite");

let db;

function getDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      position TEXT NOT NULL,
      status TEXT NOT NULL,
      type TEXT NOT NULL,
      date_demarche TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      salary TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status_history TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_applications_type ON applications(type);
    CREATE INDEX IF NOT EXISTS idx_applications_date ON applications(date_demarche);
    CREATE TABLE IF NOT EXISTS cover (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      show_stats INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

function ensureDatabase() {
  getDb();
}

function closeDatabase() {
  if (!db) return;
  db.close();
  db = null;
}

function rowToApplication(row) {
  if (!row) return null;
  let history;
  try {
    const parsed = row.status_history ? JSON.parse(row.status_history) : null;
    if (Array.isArray(parsed) && parsed.length) history = parsed;
  } catch {
    // Une ancienne entrée corrompue ne doit pas empêcher la lecture des autres fiches.
  }
  return withMigrations({
    id: row.id,
    company: row.company,
    position: row.position,
    status: row.status,
    type: row.type,
    dateDemarche: row.date_demarche,
    postalCode: row.postal_code,
    location: row.location,
    source: row.source,
    salary: row.salary,
    url: row.url,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    nextAction: row.next_action,
    notes: row.notes,
    ...(history ? { statusHistory: history } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Une candidature en paramètres nommés de SQLite (`sort_order` compris) */
function applicationParams(app, order = 0) {
  const now = new Date().toISOString();
  return {
    id: String(app.id),
    company: String(app.company ?? ""),
    position: String(app.position ?? ""),
    status: String(app.status ?? "À postuler"),
    type: String(app.type ?? "CDI"),
    date_demarche: String(app.dateDemarche ?? ""),
    postal_code: String(app.postalCode ?? ""),
    location: String(app.location ?? ""),
    source: String(app.source ?? ""),
    salary: String(app.salary ?? ""),
    url: String(app.url ?? ""),
    contact_name: String(app.contactName ?? ""),
    contact_email: String(app.contactEmail ?? ""),
    contact_phone: String(app.contactPhone ?? ""),
    next_action: String(app.nextAction ?? ""),
    notes: String(app.notes ?? ""),
    status_history: Array.isArray(app.statusHistory) ? JSON.stringify(app.statusHistory) : null,
    created_at: String(app.createdAt || now),
    updated_at: String(app.updatedAt || now),
    sort_order: order,
  };
}

const INSERT_SQL = `
  INSERT INTO applications (
    id, company, position, status, type, date_demarche, postal_code, location,
    source, salary, url, contact_name, contact_email, contact_phone, next_action,
    notes, status_history, created_at, updated_at, sort_order
  ) VALUES (
    @id, @company, @position, @status, @type, @date_demarche, @postal_code, @location,
    @source, @salary, @url, @contact_name, @contact_email, @contact_phone, @next_action,
    @notes, @status_history, @created_at, @updated_at, @sort_order
  )
`;

function readApplications() {
  return getDb()
    .prepare("SELECT * FROM applications ORDER BY sort_order ASC, rowid ASC")
    .all()
    .map(rowToApplication);
}

function countApplications(database = getDb()) {
  return database.prepare("SELECT COUNT(*) AS count FROM applications").get().count;
}

function nextOrder(database = getDb()) {
  return database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM applications").get().value;
}

module.exports = {
  DB_FILE,
  getDb,
  ensureDatabase,
  closeDatabase,
  readApplications,
  countApplications,
  nextOrder,
  applicationParams,
  INSERT_SQL,
};
