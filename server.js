// Serveur HTTP sans dépendance — suivi de candidatures (jobs / alternance / stages)
// REST API pour le front-end ET pour les agents IA (catalogue auto-documenté + OpenAPI)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { timingSafeEqual } = require("crypto");

const rules = require("./lib/rules");
const fields = require("./lib/fields");
const sqlite = require("./lib/sqlite");
const store = require("./lib/store");
const backups = require("./lib/backups");
const stats = require("./lib/stats");
const { readCover, saveCover } = require("./lib/cover");
const { importApplications } = require("./lib/import");
const { ValidationError, NotFoundError, BackupRefusedError } = require("./lib/errors");
const { applicationsPdf } = require("./lib/pdf");
const { exportList, exportSelection, backupPayload, applicationsCsv, exportFileName } = require("./lib/export");
const apiContract = require("./lib/api-contract");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1"; // l'API contient des données personnelles
const PUBLIC_DIR = path.join(__dirname, "public");
const LIB_DIR = path.join(__dirname, "lib");
const NODE_MODULES_DIR = path.join(__dirname, "node_modules");
const API_KEY = process.env.API_KEY || ""; // si défini, protège les écritures
const MAX_BODY_BYTES = 2e6; // 2 Mo : large pour un import, petit pour éviter l'abus
const VERSION = require("./package.json").version;

// ---------- Helpers HTTP ----------

function httpError(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  error.expose = true;
  return error;
}

/**
 * Traduit une erreur en réponse HTTP. Les erreurs métier de lib/errors.js portent
 * un SENS (entrée invalide, introuvable, opération refusée sans filet), pas un code :
 * c'est ici, dans le transport, que ce sens devient un statut — et nulle part ailleurs.
 */
function httpStatus(error) {
  if (error instanceof ValidationError) return { status: 400, expose: true };
  if (error instanceof NotFoundError) return { status: 404, expose: true };
  if (error instanceof BackupRefusedError) return { status: 500, expose: true };
  const exposed = Boolean(error.statusCode && error.expose);
  return { status: exposed ? error.statusCode : 500, expose: exposed };
}

function sendJSON(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      req.resume();
      reject(error);
    };

    req.on("data", (chunk) => {
      if (settled) return;
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length;
      if (size > MAX_BODY_BYTES) {
        fail(httpError(413, `Corps de requête trop volumineux (max ${MAX_BODY_BYTES / 1e6} Mo).`));
        return;
      }
      chunks.push(part);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (parsed === null || typeof parsed !== "object") throw httpError(400, "Un objet JSON est attendu.");
        resolve(parsed);
      } catch (error) {
        reject(error.expose ? error : httpError(400, "JSON invalide"));
      }
    });
    req.on("error", fail);
  });
}

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function checkAuth(req, res) {
  if (!API_KEY) return true;
  const provided = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = Buffer.from(API_KEY);
  const actual = Buffer.from(String(provided || ""));
  if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  sendJSON(res, 401, { error: "Clé API manquante ou invalide. Envoyez X-API-Key ou Authorization: Bearer <clé>." });
  return false;
}

function selectionParams(searchParams) {
  const params = Object.fromEntries(searchParams.entries());
  const errors = apiContract.validateSelectionParams(params);
  if (errors.length) throw httpError(400, errors.join(" "));
  return params;
}

function sendMethodError(res, method, pathname, methods) {
  res.setHeader("Allow", methods.join(", "));
  return sendJSON(res, 405, {
    error: `Méthode ${method} non autorisée sur ${pathname}`,
    allow: methods,
  });
}

function decodeApplicationId(pathname) {
  const match = pathname.match(/^\/api\/applications\/([^/]+)(?:\/status)?$/);
  if (!match) return null;
  try {
    return { id: decodeURIComponent(match[1]), statusRoute: pathname.endsWith("/status") };
  } catch {
    throw httpError(400, "Identifiant encodé invalide");
  }
}

// ---------- Documentation dérivée du contrat ----------

function apiCatalog(baseUrl) {
  return {
    name: "job-tracker",
    version: VERSION,
    description: "API de suivi de candidatures (jobs, alternance, stages), utilisable par des humains et des agents IA.",
    baseUrl,
    authentication: API_KEY
      ? "En-tête X-API-Key ou Authorization: Bearer <clé> (requis pour écrire)"
      : "Aucune (mode local)",
    endpoints: apiContract.catalogEndpoints(),
    enums: { statuses: rules.STATUSES, types: rules.TYPES },
    fields: fields.FIELD_DEFS,
  };
}

function openApiSpec(baseUrl) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Job Tracker API",
      version: VERSION,
      description: "Suivi de candidatures (jobs, alternance, stages), conçu pour les humains et les agents IA.",
    },
    servers: [{ url: baseUrl }],
    paths: apiContract.openApiPaths(fields.FIELD_DEFS),
  };
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // Décoder explicitement les ids avant la garde de route afin de rendre une erreur
  // 400 lisible pour un encodage invalide, plutôt qu'un 404 ambigu.
  const applicationRoute = decodeApplicationId(pathname);

  const methods = apiContract.apiMethods(pathname);
  if (methods === null) {
    return sendJSON(res, 404, { error: "Route API introuvable", hint: "GET /api pour la documentation" });
  }
  if (req.method !== "GET" && !checkAuth(req, res)) return;
  if (!methods.includes(req.method)) return sendMethodError(res, req.method, pathname, methods);

  if (pathname === "/api") return sendJSON(res, 200, apiCatalog(`http://${req.headers.host || `localhost:${PORT}`}`));

  if (pathname === "/api/openapi.json") {
    return sendJSON(res, 200, openApiSpec(`http://${req.headers.host || `localhost:${PORT}`}`));
  }

  if (pathname === "/api/schema") {
    return sendJSON(res, 200, {
      fields: fields.FIELD_DEFS,
      statuses: rules.STATUSES,
      types: rules.TYPES,
      filters: apiContract.filterDescriptions(),
      followUp: {
        delaysByStatus: rules.FOLLOWUP_DELAYS,
        defaultDelayDays: rules.FOLLOWUP_DELAY_DEFAULT,
        noFollowUpStatuses: rules.NO_FOLLOWUP_STATUSES,
        anchor: "dernier changement de statut, sinon date de démarche",
      },
      insights: apiContract.SHARED_SECTIONS.insights,
      backups: { ...apiContract.SHARED_SECTIONS.backups, keep: backups.BACKUP_KEEP, directory: backups.BACKUP_DIR },
    });
  }

  if (pathname === "/api/applications") {
    if (req.method === "GET") {
      const filters = selectionParams(searchParams);
      return sendJSON(res, 200, store.listApplications(filters));
    }
    return sendJSON(res, 201, store.createApplication(await readBody(req)));
  }

  if (applicationRoute) {
    const { id, statusRoute } = applicationRoute;
    if (statusRoute) {
      const body = await readBody(req);
      if (!body.status) return sendJSON(res, 400, { error: "Champ « status » requis" });
      return sendJSON(res, 200, store.patchApplication(id, { status: body.status }));
    }
    if (req.method === "GET") {
      const app = store.getApplication(id);
      return app ? sendJSON(res, 200, app) : sendJSON(res, 404, { error: "Candidature introuvable" });
    }
    if (req.method === "PUT") return sendJSON(res, 200, store.updateApplication(id, await readBody(req)));
    if (req.method === "PATCH") return sendJSON(res, 200, store.patchApplication(id, await readBody(req)));
    return sendJSON(res, 200, store.deleteApplication(id));
  }

  if (pathname === "/api/stats") return sendJSON(res, 200, stats.getStats());
  if (pathname === "/api/dashboard") return sendJSON(res, 200, stats.getDashboard());

  if (pathname === "/api/export") {
    return sendJSON(res, 200, backupPayload(exportList(), { cover: readCover() }));
  }

  if (pathname === "/api/export/csv") {
    const { apps, slug } = exportSelection(selectionParams(searchParams));
    const body = applicationsCsv(apps);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Length": body.length,
      "Content-Disposition": `attachment; filename="${exportFileName("csv", new Date(), slug)}"`,
    });
    return res.end(body);
  }

  if (pathname === "/api/export/pdf") {
    const { apps, selection, slug } = exportSelection(selectionParams(searchParams));
    const pdf = applicationsPdf(apps, {
      stats: stats.getStats(apps),
      cover: readCover(),
      selection: selection || undefined,
    });
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": pdf.length,
      "Content-Disposition": `attachment; filename="${exportFileName("pdf", new Date(), slug)}"`,
    });
    return res.end(pdf);
  }

  if (pathname === "/api/cover") {
    if (req.method === "GET") return sendJSON(res, 200, readCover());
    return sendJSON(res, 200, saveCover(await readBody(req)));
  }

  if (pathname === "/api/backups") {
    // Le listing annonce ce que contient chaque instantané : on choisit celui qu'on
    // restaure en connaissance de cause, et pas à l'aveugle.
    if (req.method === "GET") return sendJSON(res, 200, backups.backupListing());
    return sendJSON(res, 201, { created: backups.requireSnapshot("à la demande"), ...backups.backupListing() });
  }

  if (pathname === "/api/backups/restore") {
    const body = await readBody(req);
    if (typeof body.name !== "string" || !body.name.trim()) return sendJSON(res, 400, { error: "Champ « name » requis (voir GET /api/backups)." });
    return sendJSON(res, 200, { ...backups.restoreSnapshot(body.name), ...backups.backupListing() });
  }

  if (pathname === "/api/import") {
    const mode = searchParams.get("mode") || "merge";
    if (!apiContract.validateImportMode(mode)) return sendJSON(res, 400, { error: "Mode d'import invalide : utilisez merge ou replace." });
    return sendJSON(res, 200, importApplications(await readBody(req), { mode }));
  }

  // Toutes les routes connues ont été traitées ci-dessus. Cette branche protège
  // contre une divergence future entre le catalogue et le dispatch.
  return sendJSON(res, 500, { error: "Route API connue mais non implémentée" });
}

// ---------- Fichiers statiques ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function within(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function staticPath(pathname) {
  if (pathname === "/tabulator.js") return path.join(NODE_MODULES_DIR, "tabulator-tables", "dist", "js", "tabulator.min.js");
  if (pathname === "/tabulator.css") return path.join(NODE_MODULES_DIR, "tabulator-tables", "dist", "css", "tabulator.min.css");
  if (pathname === "/chart.js") return path.join(NODE_MODULES_DIR, "chart.js", "dist", "chart.umd.min.js");
  if (pathname === "/rules.js") return path.join(LIB_DIR, "rules.js");
  return path.resolve(PUBLIC_DIR, `.${pathname}`);
}

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    return res.end("405 — Méthode non autorisée");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("400 — Requête invalide");
  }
  if (pathname === "/") pathname = "/index.html";

  const filePath = staticPath(pathname);
  const roots = [
    PUBLIC_DIR,
    LIB_DIR,
    path.join(NODE_MODULES_DIR, "chart.js", "dist"),
    path.join(NODE_MODULES_DIR, "tabulator-tables", "dist"),
  ];
  if (!roots.some((root) => within(path.resolve(root), path.resolve(filePath)))) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("403 — Interdit");
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 — Page introuvable");
    }
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const cache = { "Cache-Control": "no-cache", ETag: etag };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, cache);
      return res.end();
    }
    fs.readFile(filePath, (readError, buffer) => {
      if (readError) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("404 — Page introuvable");
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": buffer.length,
        ...cache,
      });
      res.end(req.method === "HEAD" ? undefined : buffer);
    });
  });
}

// ---------- Serveur ----------

sqlite.ensureDatabase();
try {
  const snapshot = backups.snapshotOnStart();
  if (snapshot) console.log(`🛟 Instantané de sécurité : data/backups/${snapshot}`);
} catch (error) {
  console.error("⚠️  Instantané de démarrage impossible :", error.message);
}

const server = http.createServer({ maxHeaderSize: 32 * 1024 }, (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  applyCors(res);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error) => {
      // `expose` porte le message jusqu'au client, même en 500 : « sauvegarde
      // impossible : droits d'écriture » vaut mieux qu'un « Erreur interne »
      // devant quelqu'un qui ne peut plus rien supprimer. Le reste reste tu.
      const { status, expose } = httpStatus(error);
      if (status >= 500) console.error("Erreur serveur :", error);
      if (res.headersSent) return res.end();
      sendJSON(res, status, { error: expose ? error.message : "Erreur interne du serveur" });
    });
  } else {
    serveStatic(req, res, url);
  }
});
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

server.listen(PORT, HOST, () => {
  console.log(`✅ Suivi de candidatures : http://${HOST}:${PORT}`);
  console.log(`🤖 API pour agents IA  : http://${HOST}:${PORT}/api (docs)`);
  if (API_KEY) console.log("🔒 API_KEY active — écritures protégées");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`❌ Le port ${PORT} est déjà utilisé.`);
    console.error(`   Une autre instance tourne peut-être déjà : ouvrez http://localhost:${PORT}`);
    console.error(`   Sinon, changez de port : PORT=${PORT + 1} node server.js`);
  } else if (error.code === "EACCES") {
    console.error(`❌ Accès refusé sur le port ${PORT}. Essayez un port > 1024.`);
  } else {
    console.error(`❌ Impossible de démarrer le serveur : ${error.message}`);
  }
  process.exit(1);
});
