// Les instantanés de la base : où ils vivent, combien on en garde, quand on en
// prend un, et comment on en restaure un.
//
// La mécanique purement fichier (copie datée, rotation, contrôle d'intégrité) vit
// dans lib/snapshots.js ; ici, on l'applique à la base OUVERTE — dont la
// connexion et le schéma appartiennent à lib/sqlite.js : vider le WAL avant de
// copier, fermer avant de remplacer le fichier, rouvrir après.
const fs = require("fs");
const path = require("path");
const files = require("./files");
const { createSnapshotStore } = require("./snapshots");
const { DB_FILE, getDb, closeDatabase, ensureDatabase, readApplications } = require("./sqlite");
const { ValidationError, NotFoundError, BackupRefusedError } = require("./errors");

const BACKUP_DIR = path.join(path.dirname(DB_FILE), "backups");
const BACKUP_KEEP = 10;
const snapshots = createSnapshotStore({ dir: BACKUP_DIR, keep: BACKUP_KEEP });

/**
 * Copie la base dans data/backups/ puis applique la rotation. Le checkpoint vide
 * d'abord le WAL : le fichier sauvegardé contient bien les écritures récentes.
 */
function snapshotDatabase(date = new Date()) {
  getDb().pragma("wal_checkpoint(TRUNCATE)");
  return snapshots.copyFrom(DB_FILE, date);
}

/**
 * Un instantané de sécurité, ou un refus EXPLICITE. Une opération destructrice
 * sans filet est refusée — mais pas par un « Erreur interne du serveur » : si le
 * dossier des sauvegardes est en lecture seule, il faut lire pourquoi.
 */
function requireSnapshot(reason) {
  try {
    return snapshotDatabase();
  } catch (error) {
    throw new BackupRefusedError(
      `Sauvegarde de sécurité impossible (${reason}) : ${error.message}. ` +
        `Rien n'a été modifié. Vérifiez les droits d'écriture et l'espace disque de ${BACKUP_DIR}.`
    );
  }
}

/** Empreinte de la base ouverte (WAL vidé au préalable, sinon la copie serait partielle) */
function databaseFingerprint() {
  getDb().pragma("wal_checkpoint(TRUNCATE)");
  return files.hashFile(DB_FILE);
}

/** Instantané de démarrage, mais seulement si la base a bougé depuis le dernier. */
function snapshotOnStart() {
  if (!readApplications().length) return "";

  const newest = listSnapshots()[0];
  if (!newest) return snapshotDatabase();
  // Dix redémarrages sans écriture ne doivent pas effacer l'historique des copies
  return snapshots.fingerprint(newest.name) === databaseFingerprint() ? "" : snapshotDatabase();
}

/** Liste des instantanés (`counts: true` ajoute le nombre de fiches de chacun) */
function listSnapshots(options) {
  return snapshots.list(options);
}

/**
 * Les instantanés et ce que chacun contient. Une seule forme, pour l'API, le serveur
 * MCP et l'interface : trois listings qui divergeraient seraient trois vérités.
 */
function backupListing() {
  return { keep: BACKUP_KEEP, directory: BACKUP_DIR, files: snapshots.list({ counts: true }) };
}

/**
 * Copie un instantané à côté de la base, hors de portée de la rotation, après avoir
 * vérifié que la source est lisible — c'est elle qu'on contrôle, pas sa copie :
 * refuser AVANT toute écriture vaut mieux que refuser après.
 */
function stageSnapshot(name) {
  if (!snapshots.exists(name)) throw new NotFoundError(`Instantané introuvable : ${name || ""}`);
  try {
    snapshots.assertReadable(snapshots.pathOf(name));
  } catch (error) {
    throw new ValidationError(error.message);
  }

  const staged = files.temporaryPath(DB_FILE, "restore-source");
  files.copyAtomic(snapshots.pathOf(name), staged, "restore-stage");
  return staged;
}

/** Le WAL et le shm appartiennent à la base remplacée : ils partent avec elle. */
function dropSidecars() {
  for (const suffix of ["-wal", "-shm"]) {
    try {
      fs.unlinkSync(DB_FILE + suffix);
    } catch {
      /* absent */
    }
  }
}

/** Restaure un instantané et protège l'état courant avant de le remplacer. */
function restoreSnapshot(name) {
  // La copie de sécurité qui suit peut faire tourner les instantanés : celle que l'on
  // veut restaurer est donc mise de côté (et contrôlée) avant toute écriture, hors de
  // portée d'une rotation.
  const staged = stageSnapshot(name);
  let safety = "";

  try {
    safety = requireSnapshot("avant une restauration");
    closeDatabase();
    dropSidecars();
    snapshots.publish(staged, DB_FILE);
    snapshots.assertReadable(DB_FILE);
    ensureDatabase();
    return { restored: name, safety, total: readApplications().length };
  } catch (error) {
    // Une copie restaurée peut encore échouer au contrôle final (fichier remplacé
    // entre deux lectures, disque plein, panne Windows). Revenir à la copie de
    // sécurité est préférable à laisser l'application sur une base indéterminée.
    // Sans copie de sécurité, rien n'a été touché : il n'y a rien à rattraper.
    if (safety) {
      try {
        const rollback = stageSnapshot(safety);
        try {
          closeDatabase();
          dropSidecars();
          snapshots.publish(rollback, DB_FILE);
          snapshots.assertReadable(DB_FILE);
          ensureDatabase();
        } finally {
          files.discard(rollback);
        }
      } catch (rollbackError) {
        error.message += ` (rollback impossible : ${rollbackError.message})`;
      }
    }
    throw error;
  } finally {
    files.discard(staged);
  }
}

module.exports = {
  BACKUP_DIR,
  BACKUP_KEEP,
  snapshotDatabase,
  requireSnapshot,
  snapshotOnStart,
  listSnapshots,
  backupListing,
  restoreSnapshot,
};
