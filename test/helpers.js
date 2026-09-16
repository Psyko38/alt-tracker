// Utilitaires communs aux tests : données isolées, port libre, client MCP stdio.
// Aucune dépendance : uniquement la bibliothèque standard (node --test).
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/** Dossier temporaire propre à un fichier de test */
function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

/**
 * Environnement de test : le suivi pointe sur des fichiers temporaires, jamais sur
 * les vraies données de data/. À combiner avec `isolatedRequire` avant tout require.
 */
function isolatedEnv(dir, extra = {}) {
  const { JOB_TRACKER_DATA_FILE, JOB_TRACKER_COVER_FILE, ...base } = process.env;
  return {
    ...base,
    JOB_TRACKER_DB_FILE: path.join(dir, "applications.sqlite"),
    ...extra,
  };
}

/** Port libre : le système en choisit un, on le referme aussitôt */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Client JSON-RPC minimal pour piloter le serveur MCP en stdio, exactement comme le
 * ferait un client (Claude Desktop, Cursor…).
 */
function mcpClient(env) {
  const child = spawn(process.execPath, ["mcp-server.js"], { env, cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  let stderr = "";
  const pending = new Map();
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });

  let id = 0;
  function call(method, params) {
    const myId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP : pas de réponse à ${method}`)), 10000);
      pending.set(myId, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
    });
  }

  return {
    call,
    /** Appelle un outil et renvoie son résultat décodé (ou { error }) */
    async tool(name, args) {
      const res = await call("tools/call", { name, arguments: args });
      const text = (res.result && res.result.content && res.result.content[0] && res.result.content[0].text) || JSON.stringify(res.error);
      if (res.result && res.result.isError) return { error: text };
      return JSON.parse(text);
    },
    stderr: () => stderr,
    close() {
      child.stdin.end();
      return new Promise((resolve) => child.on("exit", resolve));
    },
  };
}

/** Attend qu'une URL réponde 2xx (le serveur HTTP met un instant à écouter) */
async function waitForHttp(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Le serveur n'a pas répondu : ${url}`);
}

// ---------- Lecture des PDF produits par lib/pdf.js ----------

/**
 * Cellules dessinées dans un PDF, avec leur position. Le générateur écrit
 * « 1 0 0 1 x y Tm (texte) Tj » : l'abscisse permet de savoir SOUS QUELLE COLONNE
 * une valeur a été posée (et pas seulement qu'elle figure quelque part).
 */
function pdfCells(pdf) {
  return [...pdf.toString("latin1").matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm \(([^)]*)\) Tj/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    text: m[3].replace(/\\([()\\])/g, "$1"),
  }));
}

/**
 * Valeurs dessinées sous une colonne, repérée par le libellé de son en-tête.
 * Seules les cellules du tableau sont retenues : les bandeaux de gauche (indicateurs)
 * et le pied de page partagent parfois l'abscisse d'une colonne sans en faire partie.
 */
function pdfColumn(pdf, header) {
  const cells = pdfCells(pdf);
  const head = cells.find((c) => c.text === header);
  if (!head) return null;
  return cells
    .filter((c) => c.text !== header && c.y < head.y - 1 && c.y > 40 && Math.abs(c.x - head.x) < 0.5)
    .map((c) => c.text);
}

/** Toutes les chaînes écrites dans le PDF (en-têtes, cellules, titres, pieds) */
function pdfTexts(pdf) {
  return [...pdf.toString("latin1").matchAll(/\(([^)]*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1"));
}

module.exports = { ROOT, tmpDir, isolatedEnv, freePort, mcpClient, waitForHttp, pdfCells, pdfColumn, pdfTexts };
