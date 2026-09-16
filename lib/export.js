// Exports partagés par le serveur HTTP (server.js) et le serveur MCP (mcp-server.js) :
// CSV prêt pour Excel et écriture des fichiers d'export sur disque. Sans dépendance
// externe : uniquement la base (lib/sqlite.js), les règles (lib/rules.js), le modèle
// (lib/model.js) et les fichiers (lib/files.js).
const fs = require("fs");
const path = require("path");
const files = require("./files");
const { DB_FILE, readApplications } = require("./sqlite");
const { fmtDateFR, selectApps, isOn, dateRangeLabel } = require("./rules");
const { withMigrations } = require("./model");
const { validateSelectionParams } = require("./api-contract");

// Libellés lisibles des filtres rapides (cartes de statistiques), pour légender l'export
const QUICK_LABELS = {
  sent: "envoyées",
  interview: "entretiens et offres",
  refused: "refusées",
  followup: "à relancer",
};

// Mêmes libellés que l'interface, pour que le CSV soit relisible tel quel
const CSV_HEADERS = [
  "Entreprise",
  "Poste",
  "Statut",
  "Type",
  "Date démarche",
  "Code postal",
  "Lieu",
  "Source",
  "Contact",
  "Email",
  "Téléphone",
  "Prochaine action",
  "Notes",
];

/** Candidatures prêtes à exporter (migrations appliquées : téléphone/e-mail rangés) */
function exportList() {
  return readApplications().map(withMigrations);
}

/** CSV compatible Excel français : séparateur « ; » et BOM UTF-8 */
function applicationsCsv(apps) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    CSV_HEADERS,
    ...apps.map((a) => [
      a.company,
      a.position,
      a.status,
      a.type,
      fmtDateFR(a.dateDemarche),
      a.postalCode,
      a.location,
      a.source,
      a.contactName,
      a.contactEmail,
      a.contactPhone,
      fmtDateFR(a.nextAction),
      a.notes,
    ]),
  ];
  return Buffer.from("\uFEFF" + rows.map((r) => r.map(esc).join(";")).join("\r\n"), "utf8");
}

/**
 * Sauvegarde JSON complète, réimportable telle quelle. Même forme pour l'API REST
 * et pour le serveur MCP, afin qu'un export de l'un puisse restaurer l'autre.
 * La page de garde du PDF fait partie de la sauvegarde : sans elle, un PC renversé
 * coûterait le titre, le sous-titre et le texte rédigés dans « Exporter → Page de garde ».
 * @param {Array} apps candidatures
 * @param {{cover?: object, exportedAt?: Date}} opts
 */
function backupPayload(apps, { cover, exportedAt = new Date() } = {}) {
  const payload = {
    exportVersion: 2,
    exportedAt: exportedAt.toISOString(),
    count: apps.length,
    applications: apps,
  };
  if (cover && typeof cover === "object") payload.cover = cover;
  return payload;
}

/**
 * Libellé de la sélection active, tel qu'il apparaît en tête du PDF :
 * « Postulé · Alternance », « à relancer », « entreprise « Vinci » »…
 */
function selectionLabel(params = {}) {
  const parts = [];
  if (QUICK_LABELS[params.quick]) parts.push(QUICK_LABELS[params.quick]);
  if (params.status) parts.push(String(params.status));
  if (params.type) parts.push(String(params.type));
  if (isOn(params.followup)) parts.push("à relancer");
  if (params.company) parts.push(`entreprise « ${params.company} »`);
  if (params.q) parts.push(`« ${params.q} »`);
  const plage = dateRangeLabel(params.from, params.to, params.dateField);
  if (plage) parts.push(plage);
  return parts.join(" · ");
}

/** « Postulé · Alternance » → « postule-alternance » (pour le nom du fichier) */
function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Candidatures retenues par une sélection, plus de quoi nommer et légender l'export.
 * Les filtres sont ceux de l'interface (même vocabulaire que `/api/applications`) :
 * « exporter ce que je vois » est donc littéralement ce que fait cette fonction.
 * @returns {{apps: Array, selection: {label: string, total: number}|null, slug: string, total: number}}
 */
function exportSelection(params = {}) {
  const errors = validateSelectionParams(params);
  if (errors.length) throw new Error(errors.join(" "));

  const all = exportList();
  const apps = selectApps(all, params);
  const label = selectionLabel(params);
  const filtered = Boolean(label) || apps.length !== all.length;
  return {
    apps,
    selection: filtered ? { label: label || "sélection", total: all.length } : null,
    slug: label ? slugify(label) : "",
    total: all.length,
  };
}

/**
 * Nom de fichier daté : candidatures-AAAA-MM-JJ[-filtre].<ext>
 * Le suffixe évite que dix exports filtrés du même jour s'écrasent dans Téléchargements.
 */
function exportFileName(ext, date = new Date(), suffix = "") {
  const p = (v) => String(v).padStart(2, "0");
  const base = `candidatures-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  return `${base}${suffix ? `-${suffix}` : ""}.${ext}`;
}

/** Chemin d'export par défaut : data/exports/candidatures-AAAA-MM-JJ[-filtre].<ext> */
function defaultExportPath(ext, suffix = "") {
  return path.join(path.dirname(DB_FILE), "exports", exportFileName(ext, new Date(), suffix));
}

/**
 * Écrit un export sur disque (dossier créé au besoin) et renvoie { path, bytes }.
 * L'écriture tout-ou-rien est celle de lib/files.js : un export interrompu ne
 * laisse pas un fichier à moitié écrit dans le dossier de téléchargement.
 */
function writeExportFile(filePath, content) {
  const target = path.resolve(String(filePath));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  files.writeAtomic(target, content);
  return { path: target, bytes: Buffer.byteLength(content) };
}

module.exports = {
  CSV_HEADERS,
  QUICK_LABELS,
  exportList,
  exportSelection,
  selectionLabel,
  slugify,
  backupPayload,
  applicationsCsv,
  exportFileName,
  defaultExportPath,
  writeExportFile,
};
