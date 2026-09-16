// Test de la migration explicite JSON → SQLite.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { tmpDir, ROOT } = require("./helpers");

test("la commande migrate:json importe les données et la couverture dans SQLite", () => {
  const dir = tmpDir("jt-migration");
  const source = path.join(dir, "applications.json");
  const cover = path.join(dir, "cover.json");
  const database = path.join(dir, "applications.sqlite");
  fs.writeFileSync(source, JSON.stringify([{ id: "legacy-1", company: "Legacy", position: "Développeur", contact: "marie.dupond@example.fr" }]));
  fs.writeFileSync(cover, JSON.stringify({ enabled: true, title: "Ancien suivi" }));

  const result = spawnSync(process.execPath, ["scripts/migrate-json.js", source, cover], {
    cwd: ROOT,
    env: { ...process.env, JOB_TRACKER_DB_FILE: database },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Migration terminée/);
  assert.ok(fs.existsSync(database));

  const check = spawnSync(process.execPath, ["-e", `
    const { readApplications } = require('./lib/sqlite');
    const { readCover } = require('./lib/cover');
    const apps = readApplications();
    if (apps.length !== 1 || apps[0].company !== 'Legacy' || apps[0].contactName !== 'Marie Dupond') process.exit(1);
    if (readCover().title !== 'Ancien suivi') process.exit(2);
  `], { cwd: ROOT, env: { ...process.env, JOB_TRACKER_DB_FILE: database }, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("le store ne migre jamais automatiquement un JSON présent", () => {
  const dir = tmpDir("jt-no-auto-migration");
  const source = path.join(dir, "applications.json");
  const database = path.join(dir, "applications.sqlite");
  fs.writeFileSync(source, JSON.stringify([{ company: "Ne doit pas migrer", position: "Dev" }]));
  const check = spawnSync(process.execPath, ["-e", `
    const { ensureDatabase, readApplications } = require('./lib/sqlite');
    ensureDatabase();
    if (readApplications().length !== 0) process.exit(1);
  `], { cwd: ROOT, env: { ...process.env, JOB_TRACKER_DB_FILE: database }, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});
