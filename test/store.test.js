// Tests de la couche de données, module par module : opérations sur les
// candidatures (lib/store.js), base et schéma (lib/sqlite.js), validation et
// migrations (lib/model.js), instantanés (lib/backups.js), page de garde
// (lib/cover.js), statistiques (lib/stats.js), import (lib/import.js) et les
// règles partagées (lib/rules.js) telles que le serveur les utilise.
// Données isolées dans un dossier temporaire : le vrai data/ n'est jamais touché.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const { tmpDir, isolatedEnv } = require("./helpers");

const dir = tmpDir("jt-store");
const env = isolatedEnv(dir);
process.env.JOB_TRACKER_DB_FILE = env.JOB_TRACKER_DB_FILE;

const store = require("../lib/store");
const sqlite = require("../lib/sqlite");
const backups = require("../lib/backups");
const model = require("../lib/model");
const cover = require("../lib/cover");
const stats = require("../lib/stats");
const rules = require("../lib/rules");
const { importApplications } = require("../lib/import");
const { NotFoundError } = require("../lib/errors");

const DB_FILE = env.JOB_TRACKER_DB_FILE;

/** Les instantanés s'accumulent dans le dossier de test : on repart d'un dossier vide */
function clearBackups() {
  fs.rmSync(backups.BACKUP_DIR, { recursive: true, force: true });
}

function reset(apps = []) {
  sqlite.closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(DB_FILE + suffix); } catch {}
  }
  sqlite.ensureDatabase();
  if (apps.length) importApplications(apps, { mode: "replace" });
}
const today = () => new Date().toISOString().slice(0, 10);

describe("création et validation", () => {
  test("company et position sont obligatoires", () => {
    reset([]);
    assert.throws(() => store.createApplication({ company: "Test" }), /intitulé du poste|position/i);
    assert.throws(() => store.createApplication({ position: "Dev" }), /entreprise|company/i);
  });

  test("valeurs par défaut : statut « À postuler », date du jour, id et createdAt", () => {
    reset([]);
    const app = store.createApplication({ company: "Villefontaine", position: "Alternance" });
    assert.equal(app.status, "À postuler");
    assert.equal(app.type, "CDI");
    assert.equal(app.dateDemarche, today());
    assert.ok(app.id && app.createdAt);
    assert.equal(app.contactPhone, "");
  });

  test("la casse du statut est tolérée, une valeur inconnue est refusée", () => {
    reset([]);
    const app = store.createApplication({ company: "X", position: "Dev", status: "entretien" });
    assert.equal(app.status, "Entretien");
    assert.throws(() => store.createApplication({ company: "X", position: "Dev", status: "Peut-être" }), /Statut invalide/);
  });

  test("les dates, URL, e-mails et champs trop longs sont refusés", () => {
    reset([]);
    assert.throws(
      () => store.createApplication({ company: "X", position: "Dev", dateDemarche: "31/02/2026" }),
      /dateDemarche.*invalide/i
    );
    assert.throws(
      () => store.createApplication({ company: "X", position: "Dev", url: "javascript:alert(1)" }),
      /url.*http/i
    );
    assert.throws(
      () => store.createApplication({ company: "X", position: "Dev", contactEmail: "pas-un-email" }),
      /contactEmail.*e-mail/i
    );
    assert.throws(
      () => store.createApplication({ company: "X".repeat(301), position: "Dev" }),
      /company.*300/i
    );
  });

  test("une suppression retire la fiche", () => {
    reset([]);
    const app = store.createApplication({ company: "X", position: "Dev" });
    store.deleteApplication(app.id);
    assert.equal(store.listApplications({}).length, 0);
  });
});

describe("modification", () => {
  test("PATCH ne modifie que les champs envoyés et horodate le statut", () => {
    reset([]);
    const app = store.createApplication({ company: "X", position: "Dev", notes: "à garder" });
    const updated = store.patchApplication(app.id, { status: "Postulé" });
    assert.equal(updated.status, "Postulé");
    assert.equal(updated.notes, "à garder");
    assert.equal(updated.company, "X");
    assert.equal(updated.statusHistory.length, 1);
    assert.equal(updated.statusHistory[0].status, "Postulé");
  });

  test("même statut : pas de nouvelle entrée d'historique", () => {
    reset([]);
    const app = store.createApplication({ company: "X", position: "Dev", status: "Postulé" });
    const updated = store.patchApplication(app.id, { status: "Postulé" });
    assert.equal(updated.statusHistory, undefined);
  });

  test("PUT refuse de vider l'entreprise", () => {
    reset([]);
    const app = store.createApplication({ company: "X", position: "Dev" });
    assert.throws(() => store.updateApplication(app.id, { company: "" }), /entreprise|company/i);
  });

  test("un contact hérité envoyé en PATCH est rangé, pas conservé", () => {
    reset([]);
    const app = store.createApplication({ company: "X", position: "Dev" });

    // L'ancien champ « contact » : l'e-mail va dans contactEmail, le nom est déduit,
    // et la clé héritée disparaît — la même migration qu'à la lecture et à l'import.
    const range = store.patchApplication(app.id, { contact: "marie.dupont@exemple.fr" });
    assert.equal(range.contactEmail, "marie.dupont@exemple.fr");
    assert.equal(range.contactName, "Marie Dupont");
    assert.equal("contact" in range, false, "la clé héritée ne doit pas être conservée");

    // …et c'est bien ce qui est écrit, pas seulement ce qui est renvoyé.
    const [relu] = sqlite.readApplications();
    assert.equal(relu.contactEmail, "marie.dupont@exemple.fr");
    assert.equal(relu.contactName, "Marie Dupont");
    assert.equal("contact" in relu, false);

    // Un numéro envoyé dans l'e-mail part dans le téléphone : même partage qu'à l'import.
    const numero = store.patchApplication(app.id, { contactEmail: "04 74 18 20 00" });
    assert.equal(numero.contactPhone, "04 74 18 20 00");
    assert.equal(numero.contactEmail, "");

    // Contrôle négatif : un PATCH qui ne parle pas des coordonnées n'y touche pas.
    const autre = store.patchApplication(app.id, { notes: "note" });
    assert.equal(autre.contactPhone, "04 74 18 20 00");
    assert.equal(autre.contactEmail, "");
    assert.equal(autre.contactName, "Marie Dupont");
  });

  test("id inconnu : null à la lecture, erreur « introuvable » en écriture", () => {
    assert.equal(store.getApplication("nope"), null);
    // Une écriture sur un id inconnu lève une erreur métier « introuvable » ; le
    // statut HTTP, lui, est décidé par le transport (server.js), pas par les données.
    assert.throws(() => store.patchApplication("nope", { status: "Postulé" }), NotFoundError);
  });
});

describe("migrations", () => {
  test("ancien champ « contact » → contactEmail (+ nom déduit)", () => {
    const app = model.withMigrations({ contact: "marie.dupond@exemple.fr" });
    assert.equal(app.contactEmail, "marie.dupond@exemple.fr");
    assert.equal(app.contactName, "Marie Dupond");
    assert.equal(app.contact, undefined);
  });

  test("un numéro dans le champ e-mail part dans le téléphone", () => {
    const split = (contactEmail, contactPhone = "") => model.withMigrations({ contactEmail, contactPhone });
    assert.equal(split("04 74 18 20 00").contactPhone, "04 74 18 20 00");
    assert.equal(split("04 74 18 20 00").contactEmail, "");
    assert.equal(split("04.74.93.00.54 - recrutement@bourgoinjallieu.fr").contactEmail, "recrutement@bourgoinjallieu.fr");
    assert.equal(split("04.74.93.00.54 - recrutement@bourgoinjallieu.fr").contactPhone, "04.74.93.00.54");
    assert.equal(split("+33 4 72 59 23 23").contactPhone, "+33 4 72 59 23 23");
    // Le tiret interne d'une adresse n'est jamais pris pour un séparateur
    assert.equal(split("contact@arche-medical.fr").contactEmail, "contact@arche-medical.fr");
    assert.equal(split("contact@arche-medical.fr").contactPhone, "");
    // Un numéro déjà saisi n'est jamais écrasé
    assert.equal(split("04 72 20 77 04 - contact@x.fr", "01 02 03 04 05").contactPhone, "01 02 03 04 05");
    // Texte inclassable : on ne touche à rien
    assert.equal(split("Ne prend pas").contactEmail, "Ne prend pas");
  });

  test("la migration est idempotente", () => {
    const once = model.withMigrations({ contactEmail: "04 78 42 58 58 - contact@arche-medical.fr" });
    const twice = model.withMigrations(once);
    assert.deepEqual(twice, once);
  });

  test("getDashboard fournit les séries du dashboard depuis SQLite", () => {
    reset([
      { id: "1", company: "A", position: "Dev", status: "Postulé", type: "CDI", dateDemarche: today() },
      { id: "2", company: "B", position: "Dev", status: "Entretien", type: "Alternance", dateDemarche: today() },
    ]);
    const dashboard = stats.getDashboard();
    assert.equal(dashboard.stats.total, 2);
    assert.equal(dashboard.byStatus.find((x) => x.label === "Postulé").value, 1);
    assert.equal(dashboard.byType.find((x) => x.label === "Alternance").value, 1);
    assert.equal(dashboard.monthly.length, 12);
    assert.equal(dashboard.monthly.reduce((sum, x) => sum + x.value, 0), 2);
  });

  test("ensureDatabase prépare une base vide sans consulter de JSON", () => {
    reset([{ id: "1", company: "X", position: "Dev", contactEmail: "04 72 20 77 04" }]);
    const [app] = sqlite.readApplications();
    assert.equal(app.contactPhone, "04 72 20 77 04");
    assert.ok(fs.existsSync(DB_FILE));
  });
});

describe("relances", () => {
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
  const base = { status: "Postulé", dateDemarche: iso(30).slice(0, 10) };

  test("délais par étape, et jamais de relance pour une candidature terminée", () => {
    assert.equal(rules.followUpDelay({ status: "Postulé" }), 14);
    assert.equal(rules.followUpDelay({ status: "Relance envoyée" }), 10);
    assert.equal(rules.followUpDelay({ status: "Entretien" }), 7);
    assert.equal(rules.followUpDelay({ status: "Statut importé inconnu" }), 14);
    for (const status of ["Refus", "Sans réponse", "Offre reçue", "À postuler"]) {
      assert.equal(rules.followUpDelay({ status }), 0);
      assert.equal(rules.followUpState({ ...base, status }), "");
    }
  });

  test("le compteur repart du dernier changement de statut, pas de la démarche", () => {
    // Postulée il y a 30 jours mais passée en Entretien hier : rien à relancer
    const app = { ...base, status: "Entretien", statusHistory: [{ status: "Entretien", at: iso(1) }] };
    assert.equal(rules.followUpState(app), "");
    // …et repasse à relancer une fois le délai de l'étape dépassé
    const vieux = { ...base, status: "Entretien", statusHistory: [{ status: "Entretien", at: iso(8) }] };
    assert.equal(rules.followUpState(vieux), "overdue");
    // Une simple retouche de champ ne remet pas le compteur à zéro
    const retouche = { ...base, updatedAt: new Date().toISOString() };
    assert.equal(rules.followUpState(retouche), "overdue");
  });

  test("une prochaine action fait foi : rien avant la date, « due » ensuite", () => {
    const futur = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const passe = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    assert.equal(rules.followUpState({ ...base, nextAction: futur }), "");
    assert.equal(rules.followUpState({ ...base, nextAction: passe }), "due");
    assert.equal(rules.followUpState({ ...base, nextAction: passe, status: "Refus" }), "");
  });

  test("getStats compte les relances et les entretiens", () => {
    reset([
      { id: "1", company: "A", position: "Dev", status: "Postulé", dateDemarche: iso(30).slice(0, 10) },
      { id: "2", company: "B", position: "Dev", status: "Entretien", dateDemarche: iso(2).slice(0, 10) },
      { id: "3", company: "C", position: "Dev", status: "Refus", dateDemarche: iso(30).slice(0, 10) },
      { id: "4", company: "D", position: "Dev", status: "À postuler", dateDemarche: iso(30).slice(0, 10) },
    ]);
    const result = stats.getStats();
    assert.equal(result.total, 4);
    assert.equal(result.sent, 3);
    assert.equal(result.interviews, 1);
    assert.equal(result.followUps, 1); // seule la « Postulé » dort
    assert.equal(result.byStatus.Refus, 1);
    assert.equal(result.interviewRate, 33);
  });

  test("le dashboard porte les analyses (sources, délai de réponse, entonnoir)", () => {
    reset([
      {
        id: "1", company: "A", position: "Dev", status: "Entretien", source: "LinkedIn",
        dateDemarche: "2026-09-01", statusHistory: [{ status: "Entretien", at: "2026-09-05T08:00:00Z" }],
      },
      { id: "2", company: "B", position: "Dev", status: "Postulé", source: "HelloWork", dateDemarche: "2026-09-01" },
    ]);
    const { insights } = stats.getDashboard();
    assert.deepEqual(insights.funnel.map((step) => step.value), [2, 1, 1, 0]);
    // À volume égal, les sources sont classées par ordre alphabétique
    assert.deepEqual(insights.sources.map((row) => [row.label, row.sent, row.responses]), [["HelloWork", 1, 0], ["LinkedIn", 1, 1]]);
    assert.deepEqual(insights.responseDelay, { count: 1, average: 4 });
  });
});

describe("instantanés de la base", () => {
  test("un instantané se crée, se liste et annonce sa date", () => {
    reset([{ id: "a", company: "A", position: "Dev" }]);
    clearBackups();
    assert.deepEqual(backups.listSnapshots(), []);
    const name = backups.snapshotDatabase();
    assert.match(name, /^applications-\d{8}-\d{6}-\d{3}\.sqlite$/);
    const files = backups.listSnapshots();
    assert.equal(files.length, 1);
    assert.equal(files[0].name, name);
    assert.ok(files[0].bytes > 0);
    assert.ok(!Number.isNaN(Date.parse(files[0].at)));
  });

  test("rotation : seuls les dix instantanés les plus récents restent", () => {
    reset([{ id: "a", company: "A", position: "Dev" }]);
    clearBackups();
    for (let i = 0; i < backups.BACKUP_KEEP + 3; i += 1) backups.snapshotDatabase(new Date(2026, 0, 1, 10, 0, i, i));
    const files = backups.listSnapshots();
    assert.equal(files.length, backups.BACKUP_KEEP);
    assert.equal(files[0].name, "applications-20260101-100012-012.sqlite");
    assert.equal(files[files.length - 1].name, "applications-20260101-100003-003.sqlite");
  });

  test("la copie de démarrage ne se répète pas quand la base n'a pas bougé", () => {
    reset([]);
    clearBackups();
    assert.equal(backups.snapshotOnStart(), "", "une base vide n'a rien à protéger");
    reset([{ id: "a", company: "A", position: "Dev" }]);
    clearBackups();
    assert.ok(backups.snapshotOnStart(), "le premier démarrage copie la base");
    assert.equal(backups.snapshotOnStart(), "", "sans écriture depuis, rien à copier");
    store.createApplication({ company: "B", position: "Dev" });
    assert.ok(backups.snapshotOnStart(), "une écriture depuis le dernier instantané déclenche une copie");
    assert.equal(backups.listSnapshots().length, 2);
  });

  test("restaurer remet les données d'avant, et copie l'état écrasé", () => {
    reset([{ id: "a", company: "Avant", position: "Dev" }]);
    clearBackups();
    const name = backups.snapshotDatabase();
    store.createApplication({ company: "Ajoutée après", position: "Dev" });
    assert.equal(store.listApplications({}).length, 2);

    const result = backups.restoreSnapshot(name);
    assert.equal(result.restored, name);
    assert.equal(result.total, 1);
    assert.ok(backups.listSnapshots().some((file) => file.name === result.safety));
    assert.equal(store.listApplications({})[0].company, "Avant");

    // L'instantané de sécurité est une base exploitable, pas un fichier tronqué :
    // c'est la preuve que le journal WAL était bien vidé avant la copie.
    const copy = new Database(path.join(backups.BACKUP_DIR, result.safety), { readonly: true });
    assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM applications").get().n, 2);
    copy.close();

    // La connexion rouverte relit bien la base restaurée (un prochain démarrage aussi)
    sqlite.closeDatabase();
    assert.equal(store.listApplications({}).length, 1);
  });

  test("un nom d'instantané inconnu est refusé, sans toucher aux données", () => {
    reset([{ id: "a", company: "Intacte", position: "Dev" }]);
    clearBackups();
    backups.snapshotDatabase();
    for (const name of ["inconnu.sqlite", "../../applications.sqlite", "applications-20260101-100000-000.sqlite", ""]) {
      assert.throws(() => backups.restoreSnapshot(name), /Instantané introuvable/);
    }
    assert.equal(store.listApplications({}).length, 1);
    assert.equal(store.listApplications({})[0].company, "Intacte");
  });

  test("un instantané illisible est refusé avant d'écraser la base", () => {
    reset([{ id: "a", company: "Intacte", position: "Dev" }]);
    clearBackups();
    // Un fichier qui a le bon nom mais pas le bon contenu (renommé, tronqué à la main)
    const faux = path.join(backups.BACKUP_DIR, "applications-20260101-100000-000.sqlite");
    fs.mkdirSync(backups.BACKUP_DIR, { recursive: true });
    fs.writeFileSync(faux, "ceci n'est pas une base SQLite");
    assert.equal(backups.listSnapshots().length, 1, "le nom suffit à lister l'instantané");
    assert.throws(() => backups.restoreSnapshot("applications-20260101-100000-000.sqlite"), /illisible/i);
    assert.equal(store.listApplications({})[0].company, "Intacte");
  });

  test("le listing annonce ce que contient chaque instantané", () => {
    reset([{ id: "a", company: "A", position: "Dev" }, { id: "b", company: "B", position: "Dev" }]);
    clearBackups();
    backups.snapshotDatabase();

    const [detail] = backups.listSnapshots({ counts: true });
    assert.equal(detail.applications, 2, "on doit savoir ce qu'on restaure avant de le faire");
    // Le listing ordinaire (rotation, démarrage) n'ouvre aucun fichier : rien à compter
    assert.equal(backups.listSnapshots()[0].applications, undefined);
  });

  test("sans dossier de sauvegardes inscriptible, l'opération est refusée et expliquée", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
    reset([{ id: "a", company: "Intacte", position: "Dev" }]);
    clearBackups();
    fs.mkdirSync(backups.BACKUP_DIR, { recursive: true });
    fs.chmodSync(backups.BACKUP_DIR, 0o555);
    try {
      // Refuser vaut mieux que faire disparaître une fiche sans filet — mais il faut
      // dire pourquoi, sinon l'utilisateur ne peut plus rien supprimer sans savoir.
      assert.throws(() => store.deleteApplication("a"), /Sauvegarde de sécurité impossible/);
      assert.throws(() => store.deleteApplication("a"), /droits d'écriture/);
      assert.equal(store.listApplications({}).length, 1, "rien ne doit disparaître sans instantané");
      assert.equal(store.listApplications({})[0].company, "Intacte");
    } finally {
      fs.chmodSync(backups.BACKUP_DIR, 0o755);
    }
    // Droits rendus : la suppression redevient possible, instantané compris
    assert.deepEqual(store.deleteApplication("a"), { ok: true });
    assert.equal(store.listApplications({}).length, 0);
    assert.equal(backups.listSnapshots().length, 1);
  });

  test("lire les instantanés n'écrit rien dans le dossier des sauvegardes", () => {
    reset([{ id: "a", company: "A", position: "Dev" }]);
    clearBackups();
    backups.snapshotDatabase();
    backups.snapshotDatabase();

    // Le listing ouvre chaque copie pour compter les fiches : sqlite crée un -wal et un
    // -shm à côté d'une base en mode WAL, même en lecture seule. S'ils restaient, le
    // dossier se remplirait de fichiers morts que la rotation ne supprime jamais —
    // « les 10 plus récents sont conservés » deviendrait faux à l'échelle du disque.
    backups.listSnapshots({ counts: true });
    const noms = backups.listSnapshots().map((file) => file.name).sort();
    assert.equal(noms.length, 2);
    assert.deepEqual(fs.readdirSync(backups.BACKUP_DIR).sort(), noms, "le dossier ne doit contenir que les instantanés");

    // La rotation non plus ne laisse rien derrière elle
    for (let i = 0; i < backups.BACKUP_KEEP; i += 1) backups.snapshotDatabase(new Date(2026, 0, 1, 10, 0, i, i));
    const apres = backups.listSnapshots().map((file) => file.name).sort();
    assert.equal(apres.length, backups.BACKUP_KEEP);
    assert.deepEqual(fs.readdirSync(backups.BACKUP_DIR).sort(), apres);
  });

  test("une restauration ne laisse rien traîner derrière elle", () => {
    reset([{ id: "a", company: "A", position: "Dev" }]);
    clearBackups();
    const name = backups.snapshotDatabase();
    store.createApplication({ company: "B", position: "Dev" });
    backups.restoreSnapshot(name);

    // La copie de travail qui devient la base ne doit laisser ni son nom ni ses annexes
    const restes = fs.readdirSync(dir).filter((entry) => entry.includes("restore-source") || entry.endsWith(".tmp"));
    assert.deepEqual(restes, [], "aucun fichier de travail ne doit rester à côté de la base");
    // Et la vérification de l'instantané n'a rien déposé dans le dossier des sauvegardes
    assert.deepEqual(
      fs.readdirSync(backups.BACKUP_DIR).sort(),
      backups.listSnapshots().map((file) => file.name).sort()
    );
  });

  test("une restauration refusée ne laisse pas de copie de la base derrière elle", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
    reset([{ id: "a", company: "Intacte", position: "Dev" }]);
    clearBackups();
    const name = backups.snapshotDatabase();

    fs.chmodSync(backups.BACKUP_DIR, 0o555);
    try {
      // Pas de filet, pas de restauration — et la copie de travail préparée avant le
      // refus doit être remballée : refuser ne laisse pas un double de la base traîner.
      assert.throws(() => backups.restoreSnapshot(name), /Sauvegarde de sécurité impossible/);
    } finally {
      fs.chmodSync(backups.BACKUP_DIR, 0o755);
    }

    assert.equal(store.listApplications({})[0].company, "Intacte", "les données n'ont pas bougé");
    const restes = fs.readdirSync(dir).filter((entry) => entry.includes("restore-source") || entry.endsWith(".tmp"));
    assert.deepEqual(restes, [], "aucun fichier de travail ne doit rester après un refus");
  });

  test("une suppression copie la base avant, donc reste réversible", () => {
    reset([{ id: "a", company: "À retrouver", position: "Dev" }]);
    clearBackups();
    store.deleteApplication("a");
    assert.equal(store.listApplications({}).length, 0);
    const files = backups.listSnapshots();
    assert.equal(files.length, 1);
    backups.restoreSnapshot(files[0].name);
    assert.equal(store.listApplications({})[0].company, "À retrouver");

    // Idem pour une suppression en masse
    clearBackups();
    store.deleteApplications(store.listApplications({}).map((app) => app.id));
    assert.equal(store.listApplications({}).length, 0);
    assert.equal(backups.listSnapshots().length, 1);
  });
});

describe("import / export", () => {
  test("fusion : les doublons d'id sont ignorés, les invalides signalés", () => {
    reset([{ id: "a", company: "Déjà là", position: "Dev" }]);
    const summary = importApplications([
      { id: "a", company: "Déjà là", position: "Dev" },
      { company: "Nouvelle", position: "Dev" },
      { company: "Sans poste" },
    ]);
    assert.equal(summary.mode, "merge");
    assert.equal(summary.added, 1);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.invalid.length, 1);
    assert.equal(store.listApplications({}).length, 2);
  });

  test("remplacement : un instantané des données écrasées est pris avant", () => {
    reset([{ id: "a", company: "Ancienne", position: "Dev" }]);
    const summary = importApplications({ applications: [{ company: "Nouvelle", position: "Dev" }] }, { mode: "replace" });
    assert.equal(summary.mode, "replace");
    assert.equal(summary.added, 1);
    assert.match(summary.backup, /^applications-\d{8}-\d{6}-\d{3}\.sqlite$/);
    const backup = fs.statSync(path.join(backups.BACKUP_DIR, summary.backup));
    assert.ok(backup.size > 0);
    assert.equal(store.listApplications({}).length, 1);
  });

  test("la page de garde du fichier est restaurée (fusion et remplacement)", () => {
    reset([]);
    cover.saveCover({ enabled: true, title: "Titre d'origine", text: "texte" });
    const summary = importApplications({ applications: [{ company: "X", position: "Dev" }], cover: { enabled: true, title: "Restaurée" } });
    assert.equal(summary.cover, true);
    assert.equal(cover.readCover().title, "Restaurée");
    // Un fichier sans page de garde la laisse tranquille
    const sansCover = importApplications([{ company: "Y", position: "Dev" }]);
    assert.equal(sansCover.cover, false);
    assert.equal(cover.readCover().title, "Restaurée");
  });

  test("un remplacement sans candidature valide conserve les données", () => {
    reset([{ id: "safe", company: "À conserver", position: "Dev" }]);
    assert.throws(
      () => importApplications({ applications: [{ company: "", position: "" }] }, { mode: "replace" }),
      /Aucune candidature valide/
    );
    assert.equal(store.listApplications({})[0].company, "À conserver");
  });
});

describe("écriture des données", () => {
  test("l'écriture SQLite ne produit pas de fichier JSON miroir", () => {
    reset([]);
    store.createApplication({ company: "X", position: "Dev" });
    assert.ok(fs.existsSync(DB_FILE));
    assert.equal(fs.existsSync(path.join(dir, "applications.json")), false);
  });

  test("un import invalide ne modifie pas la base SQLite", () => {
    reset([{ id: "safe", company: "À conserver", position: "Dev" }]);
    assert.throws(() => importApplications({ applications: [{ company: "", position: "" }] }, { mode: "replace" }), /Aucune candidature valide/);
    assert.equal(store.listApplications({})[0].company, "À conserver");
  });
});
