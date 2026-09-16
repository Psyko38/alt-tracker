#!/usr/bin/env node
// Migration explicite et irréversible dans le sens applicatif : JSON legacy → SQLite.
// L'application ne lit jamais automatiquement le fichier source.
const fs = require("node:fs");
const path = require("node:path");

function usage() {
  console.error("Usage : node scripts/migrate-json.js <applications.json> [cover.json]");
  console.error("La base cible est JOB_TRACKER_DB_FILE ou data/applications.sqlite.");
  process.exitCode = 2;
}

const [source, coverSource] = process.argv.slice(2);
if (!source) usage();
else {
  const sqlite = require("../lib/sqlite");
  const { importApplications } = require("../lib/import");
  const sourcePath = path.resolve(source);
  try {
    if (!fs.statSync(sourcePath).isFile()) throw new Error("la source n'est pas un fichier");
    const parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("le fichier applications doit contenir un tableau JSON");

    let payload = parsed;
    if (coverSource) {
      const coverPath = path.resolve(coverSource);
      if (!fs.statSync(coverPath).isFile()) throw new Error("le fichier cover n'est pas un fichier");
      payload = { applications: parsed, cover: JSON.parse(fs.readFileSync(coverPath, "utf8")) };
    }

    sqlite.ensureDatabase();
    const summary = importApplications(payload, { mode: "replace" });
    console.log(`Migration terminée : ${summary.added} candidature(s) importée(s) dans ${sqlite.DB_FILE}`);
    if (summary.invalid.length) console.warn(`${summary.invalid.length} entrée(s) ignorée(s) : ${summary.invalid.join(" | ")}`);
    if (summary.backup) console.log(`Sauvegarde SQLite précédente : ${summary.backup}`);
    console.log("Le fichier JSON source n'est désormais plus utilisé par l'application.");
  } catch (err) {
    console.error(`Migration impossible : ${err.message}`);
    process.exitCode = 1;
  }
}
