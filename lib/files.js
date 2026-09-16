// Utilitaires de fichiers : écritures « tout ou rien », copie, empreinte.
// Un fichier de données à moitié écrit est un fichier perdu : on écrit donc une
// copie temporaire dans le MÊME dossier, on la synchronise sur le disque, puis on
// la publie d'un seul rename. Écrit une fois ici, utilisé par les exports
// (lib/export.js) et par les instantanés de la base (lib/snapshots.js).
const fs = require("fs");
const { randomUUID, createHash } = require("crypto");

/** Chemin temporaire à côté de la cible (un rename ne traverse pas un disque) */
function temporaryPath(target, label = "tmp") {
  return `${target}.${label}-${process.pid}-${Date.now()}-${randomUUID()}.tmp`;
}

/** Supprime un fichier en ignorant l'échec : déjà renommé, ou dossier en lecture seule */
function discard(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* rien à nettoyer */
  }
}

/**
 * Crée le temporaire avec les droits de la cible, laisse `fill` y écrire le
 * contenu, force le disque, puis publie le tout d'un rename.
 */
function publishTemporarily(target, label, fill) {
  const temporary = temporaryPath(target, label);
  try {
    const fd = fs.openSync(temporary, "w", 0o600);
    try {
      fill(temporary);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, target);
  } finally {
    discard(temporary);
  }
  return target;
}

/** Écrit `content` dans `target` : un lecteur concurrent voit l'ancien ou le nouveau */
function writeAtomic(target, content) {
  return publishTemporarily(target, "write", (temporary) => fs.writeFileSync(temporary, content));
}

/** Copie `source` vers `target` avec les mêmes garanties */
function copyAtomic(source, target, label = "copy") {
  return publishTemporarily(target, label, (temporary) => fs.copyFileSync(source, temporary));
}

/**
 * Publie `source` à la place de `target` et consomme `source`. POSIX remplace
 * atomiquement ; Windows refuse souvent un rename sur une cible existante, d'où
 * l'ancienne déplacée puis remise en place si le second rename échoue.
 */
function replaceAtomic(source, target) {
  const displaced = temporaryPath(target, "previous");
  let movedExisting = false;
  try {
    try {
      fs.renameSync(source, target);
    } catch (error) {
      if (!["EEXIST", "EPERM", "EACCES"].includes(error.code)) throw error;
      if (fs.existsSync(target)) {
        fs.renameSync(target, displaced);
        movedExisting = true;
      }
      try {
        fs.renameSync(source, target);
      } catch (renameError) {
        if (movedExisting && !fs.existsSync(target)) fs.renameSync(displaced, target);
        throw renameError;
      }
    }
  } finally {
    if (movedExisting) discard(displaced); // l'ancien état vit déjà ailleurs
  }
}

/** Empreinte SHA-256 d'un fichier ("" s'il n'existe pas) */
function hashFile(file) {
  return fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "";
}

module.exports = { temporaryPath, discard, writeAtomic, copyAtomic, replaceAtomic, hashFile };
