// Erreurs métier typées : elles disent CE QUI a échoué, pas sous quelle forme le
// transport doit le rendre. La couche de données ne pose donc ni `statusCode` ni
// `expose` — c'est server.js qui traduit ces classes en codes HTTP, à l'endroit où
// la question du protocole se pose vraiment. `name` est ce que lisent les tests.

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

class NotFoundError extends Error {
  constructor(message = "Candidature introuvable") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Une opération destructrice sans filet est refusée : la raison doit remonter
 * jusqu'à l'utilisateur (droits d'écriture, espace disque), pas devenir un
 * « Erreur interne du serveur » devant quelqu'un qui ne peut plus rien supprimer.
 */
class BackupRefusedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupRefusedError";
  }
}

module.exports = { ValidationError, NotFoundError, BackupRefusedError };
