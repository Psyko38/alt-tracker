#!/usr/bin/env node
// Serveur MCP (Model Context Protocol) — permet à un agent IA (Claude Desktop,
// Cursor, etc.) de manipuler les candidatures via des "tools" standards.
// Aucune dépendance : implémente le transport stdio JSON-RPC de MCP.
//
// Configuration type (Claude Desktop / Cursor / autre client MCP) :
// {
//   "mcpServers": {
//     "job-tracker": {
//       "command": "node",
//       "args": ["/chemin/vers/job-tracker/mcp-server.js"]
//     }
//   }
// }

const fs = require("fs");
const path = require("path");

const rules = require("./lib/rules");
const fields = require("./lib/fields");
const sqlite = require("./lib/sqlite");
const store = require("./lib/store");
const backups = require("./lib/backups");
const stats = require("./lib/stats");
const { COVER_DEFAULTS, readCover, saveCover } = require("./lib/cover");
const { importApplications } = require("./lib/import");
const { applicationsPdf } = require("./lib/pdf");
const {
  exportList,
  exportSelection,
  backupPayload,
  applicationsCsv,
  defaultExportPath,
  writeExportFile,
} = require("./lib/export");

const {
  IMPORT_MODES,
  SHARED_SECTIONS,
  applicationProperties,
  filterProperties,
  validateImportMode,
  validateSelectionParams,
} = require("./lib/api-contract");

const VERSION = require("./package.json").version;

sqlite.ensureDatabase();

/** Propriété `path` commune aux trois outils d'export */
const PATH_PROP = {
  type: "string",
  description:
    "Fichier de destination (chemin absolu ou relatif au dossier courant). Par défaut : data/exports/candidatures-AAAA-MM-JJ.<ext>",
};

// ---------- Outils exposés à l'agent ----------

function validatedSelection(args = {}) {
  const errors = validateSelectionParams(args);
  if (errors.length) throw new Error(errors.join(" "));
  return args;
}


const TOOLS = [
  {
    name: "get_schema",
    description:
      "Catalogue du suivi (point de départ conseillé pour un agent) : champs disponibles avec leur type, statuts et types de contrat autorisés, délais de relance par étape, options de la page de garde du PDF, conventions et formats d'export/import.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_applications",
    description:
      "Lister les candidatures suivies. Filtres optionnels par statut, type de contrat, entreprise, recherche texte, et plage de dates (from/to, bornes incluses, sur la date de démarche par défaut).",
    inputSchema: {
      type: "object",
      properties: filterProperties(),
    },
  },
  {
    name: "get_application",
    description: "Récupérer une candidature par son id.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "Id de la candidature" } },
    },
  },
  {
    name: "create_application",
    description:
      "Créer une nouvelle candidature. Champs obligatoires : company (entreprise) et position (poste).",
    inputSchema: {
      type: "object",
      required: ["company", "position"],
      properties: applicationProperties(fields.FIELD_DEFS),
    },
  },
  {
    name: "update_application",
    description:
      "Mettre à jour un ou plusieurs champs d'une candidature existante (ne modifie que les champs fournis).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Id de la candidature" },
        ...applicationProperties(fields.FIELD_DEFS),
      },
    },
  },
  {
    name: "set_status",
    description:
      "Raccourci : ne change que le statut d'une candidature (le changement est horodaté dans l'historique et recale la relance).",
    inputSchema: {
      type: "object",
      required: ["id", "status"],
      properties: {
        id: { type: "string", description: "Id de la candidature" },
        status: { type: "string", enum: rules.STATUSES, description: "Nouveau statut" },
      },
    },
  },
  {
    name: "delete_application",
    description: "Supprimer définitivement une candidature.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "Id de la candidature" } },
    },
  },
  {
    name: "get_stats",
    description:
      "Statistiques du suivi : total, envoyées, entretiens en cours, entretiens déjà obtenus, taux de réponse (entretiens obtenus ÷ envois), candidatures à relancer (followUps), répartition par statut et par type.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_cover",
    description:
      "Lire la page de garde de l'export PDF (page 1) : { enabled, title, subtitle, text, showStats }.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_cover",
    description:
      "Modifier la page de garde de l'export PDF. Seuls les champs fournis changent (fusion). `enabled: true` ajoute la page de garde en page 1, le tableau commence alors page 2.",
    inputSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "Ajouter la page de garde au PDF" },
        title: { type: "string", description: "Titre de la page de garde" },
        subtitle: { type: "string", description: "Sous-titre" },
        text: { type: "string", description: "Texte libre (retours à la ligne conservés)" },
        showStats: { type: "boolean", description: "Afficher les indicateurs sur la page de garde" },
      },
    },
  },
  {
    name: "export_applications",
    description:
      "Exporter TOUT le suivi en JSON (sauvegarde complète, réimportable avec import_applications) : candidatures + page de garde du PDF (cover). Le fichier est écrit sur le disque et son chemin est renvoyé. Volontairement non filtrable : une sauvegarde partielle ne doit pas pouvoir écraser le reste à la restauration.",
    inputSchema: { type: "object", properties: { path: PATH_PROP } },
  },
  {
    name: "export_csv",
    description:
      "Exporter le tableau en CSV (« ; » + BOM UTF-8, s'ouvre directement dans Excel ou Google Sheets, téléphone du contact inclus). Options de sélection : status, type, company, q, followup, quick, limit (facultatives — sans elles, tout le suivi est exporté). Le fichier est écrit sur le disque et son chemin est renvoyé.",
    inputSchema: { type: "object", properties: { ...filterProperties(), path: PATH_PROP } },
  },
  {
    name: "export_pdf",
    description:
      "Générer le tableau PDF A4 paysage multi-pages (page de garde incluse si elle est activée) et l'écrire sur le disque ; renvoie le chemin et la taille du fichier. Options de sélection : status, type, company, q, followup, quick, limit (facultatives). Les indicateurs de l'en-tête portent alors sur la sélection, et le filtre est rappelé dans le PDF.",
    inputSchema: { type: "object", properties: { ...filterProperties(), path: PATH_PROP } },
  },
  {
    name: "import_applications",
    description:
      "Importer des candidatures : soit `data` (tableau, objet unique, ou export complet { applications: [...], cover: {...} }), soit `path` (fichier JSON, par exemple une sauvegarde faite avec export_applications). Mode « merge » (défaut) : ajoute les nouvelles en ignorant les doublons d'id ; « replace » : remplace tout le suivi. La page de garde du PDF présente dans le fichier est restaurée dans les deux modes.",
    inputSchema: {
      type: "object",
      properties: {
        data: {
          description: "Tableau de candidatures, objet unique, ou export complet { applications: [...] }",
        },
        path: { type: "string", description: "Fichier JSON à importer (alternative à `data`)" },
        mode: { type: "string", enum: IMPORT_MODES, description: "merge (défaut) ou replace" },
      },
    },
  },
  {
    name: "list_backups",
    description:
      "Lister les instantanés de sécurité de la base (data/backups) : nom, date, taille et nombre de candidatures contenues, du plus récent au plus ancien. Utile avant une manipulation risquée, pour savoir de quel état on peut revenir.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_backup",
    description:
      "Créer un instantané de sécurité à la demande (par exemple avant une série de modifications ou un import en remplacement) et renvoyer son nom.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "restore_backup",
    description:
      "Restaurer la base depuis un instantané nommé (voir list_backups) : tout le suivi revient à cet état. L'état écrasé est copié avant, donc une restauration reste réversible.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description: "Nom de l'instantané à restaurer, tel que renvoyé par list_backups (applications-AAAA... .sqlite)",
        },
      },
    },
  },
  {
    name: "get_followups",
    description:
      "Lister les candidatures à relancer : prochaine action atteinte/dépassée, ou aucun mouvement (changement de statut, sinon date de démarche) depuis le délai de l'étape en cours (14 j après « Postulé », 10 j après « Relance envoyée », 7 j après « Entretien »). Les candidatures terminées et celles jamais postulées sont exclues.",
    inputSchema: { type: "object", properties: {} },
  },
];

function callTool(name, args) {
  switch (name) {
    case "get_schema":
      return {
        fields: fields.FIELD_DEFS,
        statuses: rules.STATUSES,
        types: rules.TYPES,
        followUp: {
          delaysByStatus: rules.FOLLOWUP_DELAYS,
          defaultDelayDays: rules.FOLLOWUP_DELAY_DEFAULT,
          noFollowUpStatuses: rules.NO_FOLLOWUP_STATUSES,
          anchor: "dernier changement de statut, sinon date de démarche",
        },
        cover: {
          file: sqlite.DB_FILE,
          defaults: COVER_DEFAULTS,
          options: ["enabled", "title", "subtitle", "text", "showStats"],
        },
        conventions: {
          dates: "AAAA-MM-JJ accepté, JJ/MM/AAAA aussi (stocké en ISO)",
          statusCase: "casse tolérée à l'écriture ; les statuts et types inconnus sont refusés à l'import",
          contact:
            "un numéro saisi dans contactEmail est rangé automatiquement dans contactPhone (interface, CSV et PDF l'affichent), donc mieux vaut remplir le bon champ",
          exports:
            "export_applications (JSON réimportable, page de garde comprise, toujours complet), export_csv (Excel) et export_pdf (A4 paysage) : les trois écrivent un fichier sur le disque. CSV et PDF acceptent les mêmes filtres que /api/applications (status, type, company, q, followup, quick, from, to, dateField, sort, dir, selectSort, limit) pour n'exporter qu'une sélection ; l'en-tête du PDF et le nom du fichier la rappellent",
          import:
            "import_applications accepte `data` ou `path`, en mode merge (défaut) ou replace ; la page de garde du fichier est restaurée dans les deux cas",
        },
        databaseFile: sqlite.DB_FILE,
        ...SHARED_SECTIONS,
      };
    case "list_applications":
      return store.listApplications(validatedSelection(args || {}));
    case "get_application": {
      const app = store.getApplication(args.id);
      if (!app) throw new Error("Candidature introuvable : " + args.id);
      return app;
    }
    case "create_application":
      return store.createApplication(args || {});
    case "update_application": {
      const { id, ...patch } = args || {};
      return store.patchApplication(id, patch);
    }
    case "set_status":
      return store.patchApplication(args.id, { status: args.status });
    case "delete_application":
      return store.deleteApplication(args.id);
    case "get_stats":
      return stats.getStats();
    case "export_applications": {
      const apps = exportList();
      const cover = readCover();
      const file = writeExportFile(
        args?.path || defaultExportPath("json"),
        JSON.stringify(backupPayload(apps, { cover }), null, 2) + "\n"
      );
      // `cover` : la page de garde telle qu'elle est partie dans la sauvegarde
      return { format: "json", count: apps.length, cover, ...file };
    }
    case "export_csv": {
      const { apps, selection, slug, total } = exportSelection(args || {});
      const file = writeExportFile(args?.path || defaultExportPath("csv", slug), applicationsCsv(apps));
      return {
        format: "csv",
        count: apps.length,
        total,
        ...(selection ? { selection: selection.label } : {}),
        ...file,
      };
    }
    case "export_pdf": {
      const { apps, selection, slug, total } = exportSelection(args || {});
      const pdf = applicationsPdf(apps, {
        stats: stats.getStats(apps),
        cover: readCover(),
        selection: selection || undefined,
      });
      const file = writeExportFile(args?.path || defaultExportPath("pdf", slug), pdf);
      return {
        format: "pdf",
        count: apps.length,
        total,
        ...(selection ? { selection: selection.label } : {}),
        ...file,
      };
    }
    case "import_applications": {
      const { data, path: source, mode } = args || {};
      let payload = data;
      let sourcePath;
      if (payload === undefined && source) {
        sourcePath = path.resolve(String(source));
        // L'outil MCP lit explicitement un fichier choisi par l'agent : refuser
        // les répertoires et les chemins inexistants rend l'erreur immédiate.
        if (!fs.statSync(sourcePath).isFile()) throw new Error("Le chemin d'import n'est pas un fichier.");
      }
      if (payload === undefined) {
        if (!sourcePath) throw new Error("Fournir `data` (JSON) ou `path` (fichier JSON à importer).");
        try {
          payload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
        } catch (err) {
          throw new Error(`Fichier illisible (${sourcePath}) : ${err.message}`);
        }
      }
      const importMode = mode === undefined || mode === "" ? "merge" : mode;
      if (!validateImportMode(importMode)) {
        throw new Error("Mode d'import invalide : utilisez merge ou replace.");
      }
      return importApplications(payload, { mode: importMode });
    }
    // Le même listing que GET /api/backups : une seule forme, deux transports.
    case "list_backups":
      return backups.backupListing();
    case "create_backup":
      return { created: backups.requireSnapshot("à la demande"), ...backups.backupListing() };
    case "restore_backup":
      return { ...backups.restoreSnapshot(args.name), ...backups.backupListing() };
    case "get_cover":
      return readCover();
    case "set_cover":
      return saveCover(args || {});
    case "get_followups":
      return store
        .listApplications({})
        .filter((a) => rules.followUpState(a))
        .map((a) => ({
          id: a.id,
          company: a.company,
          position: a.position,
          status: a.status,
          contactName: a.contactName,
          contactEmail: a.contactEmail,
          contactPhone: a.contactPhone,
          nextAction: a.nextAction,
          delay: rules.followUpDelay(a),
          daysSinceLastMove: rules.daysSinceActivity(a),
          raison:
            rules.followUpState(a) === "due"
              ? "prochaine action atteinte"
              : `aucun mouvement depuis ${rules.daysSinceActivity(a)} jours (délai de l'étape : ${rules.followUpDelay(a)} jours)`,
        }));
    default:
      throw new Error("Outil inconnu : " + name);
  }
}

// ---------- JSON-RPC over stdio (MCP) ----------

const PROTOCOL_VERSION = "2024-11-05";

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handleMessage(line);
  }
});

function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return replyError(null, -32700, "Parse error");
  }

  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "job-tracker",
          version: VERSION,
          description: "Suivi de candidatures (jobs, alternance, stages)",
        },
      });

    case "notifications/initialized":
      return; // notification, pas de réponse

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, { tools: TOOLS });

    case "tools/call": {
      const { name, arguments: args } = params || {};
      try {
        const data = callTool(name, args);
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        });
      } catch (err) {
        // Erreur "métier" : renvoyée à l'agent comme résultat lisible
        return reply(id, {
          content: [{ type: "text", text: "Erreur : " + err.message }],
          isError: true,
        });
      }
    }

    default:
      if (id !== undefined) {
        return replyError(id, -32601, "Method not found: " + method);
      }
  }
}

process.stdin.on("end", () => process.exit(0));

console.error(`[job-tracker MCP] prêt — ${TOOLS.length} outils : ${TOOLS.map((t) => t.name).join(", ")}`);
