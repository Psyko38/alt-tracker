// Instantanés de la base : copies datées, rotation, contrôle d'intégrité.
// Ce module ne connaît ni `lib/backups.js` ni la connexion SQLite de l'application :
// il ne manipule que des fichiers — sauf pour vérifier qu'une copie est bien une
// base lisible avant qu'on la remette en place. La politique (où, combien) est
// passée à la construction ; l'application l'instancie une fois.
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { copyAtomic, replaceAtomic, hashFile } = require("./files");

/** Un instantané, c'est ce nom — et rien d'autre n'entre dans le dossier */
const SNAPSHOT_RE = /^applications-\d{8}-\d{6}-\d{3}\.sqlite$/;

/**
 * Ouvre une base EN LECTURE SEULE sans rien écrire à côté d'elle : sqlite crée un -wal
 * et un -shm dès qu'il lit une base en mode WAL, même en lecture seule. On lit donc une
 * copie jetable dans le dossier temporaire du système, qui part avec ses annexes.
 * Lire un instantané ne doit pas déposer de fichiers dans le dossier qu'on inspecte.
 */
function readOnlyInspect(file, inspect) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "job-tracker-read-"));
  let database;
  try {
    const copy = path.join(scratch, path.basename(file));
    fs.copyFileSync(file, copy);
    database = new Database(copy, { readonly: true });
    return inspect(database);
  } finally {
    try {
      if (database) database.close();
    } catch {
      /* rien à fermer */
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * @param {{dir: string, keep?: number}} options dossier des instantanés, nombre conservé
 */
function createSnapshotStore({ dir, keep = 10 }) {
  if (!dir) throw new Error("createSnapshotStore : dossier requis");

  /** applications-AAAAMMJJ-HHMMSS-mmm.sqlite (le nom date le contenu, et le classe) */
  function nameFor(date = new Date()) {
    const pad = (value, size = 2) => String(value).padStart(size, "0");
    return `applications-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}.sqlite`;
  }

  function pathOf(name) {
    return path.join(dir, String(name));
  }

  /** Nom d'instantané connu ET présent sur le disque — jamais un chemin venu d'ailleurs */
  function exists(name) {
    return SNAPSHOT_RE.test(String(name)) && fs.existsSync(pathOf(name));
  }

  /** Premier nom libre à partir de `date` : deux copies dans la même milliseconde cohabitent */
  function freeName(date = new Date()) {
    let cursor = new Date(date.getTime());
    for (let step = 0; step < 1000; step += 1) {
      const candidate = nameFor(cursor);
      if (!fs.existsSync(pathOf(candidate))) return candidate;
      cursor = new Date(cursor.getTime() + 1);
    }
    throw new Error("impossible de nommer l'instantané");
  }

  /** Nombre de fiches contenues dans un instantané (null si le fichier est illisible) */
  function countApplications(name) {
    try {
      return readOnlyInspect(pathOf(name), (database) =>
        database.prepare("SELECT COUNT(*) AS count FROM applications").get().count
      );
    } catch {
      return null;
    }
  }

  /** Les instantanés, du plus récent au plus ancien (le nom les classe déjà) */
  function list({ counts = false } = {}) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => SNAPSHOT_RE.test(name))
      .sort()
      .reverse()
      .map((name) => {
        const stats = fs.statSync(pathOf(name));
        return {
          name,
          bytes: stats.size,
          at: stats.mtime.toISOString(),
          ...(counts ? { applications: countApplications(name) } : {}),
        };
      });
  }

  /** Rotation : au-delà de `keep`, les plus anciens partent */
  function removeOld() {
    for (const old of list().slice(keep)) {
      try {
        fs.unlinkSync(pathOf(old.name));
      } catch {
        /* rotation au mieux */
      }
    }
  }

  /** Copie `sourceFile` dans le dossier, puis applique la rotation ("", si la source manque) */
  function copyFrom(sourceFile, date = new Date()) {
    if (!fs.existsSync(sourceFile)) return "";
    fs.mkdirSync(dir, { recursive: true });
    const name = freeName(date);
    copyAtomic(sourceFile, pathOf(name), "snapshot");
    removeOld();
    return name;
  }

  /** Empreinte d'un instantané ("" s'il a disparu) */
  function fingerprint(name) {
    return hashFile(pathOf(name));
  }

  /** Refuse un fichier qui n'est pas une base lisible : on ne restaure pas une devinette */
  function assertReadable(file) {
    try {
      readOnlyInspect(file, (database) => {
        if (database.pragma("quick_check", { simple: true }) !== "ok") throw new Error("contrôle d'intégrité en échec");
      });
    } catch (error) {
      throw new Error(`Instantané illisible (${path.basename(file)}) : ${error.message}`);
    }
  }

  /** Met un instantané en place à la place de `target` (le fichier source est consommé) */
  function publish(source, target) {
    replaceAtomic(source, target);
  }

  // Seule surface utilisée par l'application : le reste reste interne au module.
  return { pathOf, exists, copyFrom, list, fingerprint, assertReadable, publish };
}

module.exports = { createSnapshotStore };
