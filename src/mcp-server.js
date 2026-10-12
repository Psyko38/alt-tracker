#!/usr/bin/env node
/**
 * Alt-Tracker — Model Context Protocol (MCP) Server & Connector Engine
 * Supports:
 * 1. Stdio transport (for Claude Desktop, Cursor, Antigravity, Windsurf: `node src/mcp-server.js`)
 * 2. HTTP JSON-RPC 2.0 transport (`POST /api/mcp` and `GET /api/mcp/info`)
 * 3. Outbound MCP Client Probing (`probeExternalMcpServer`)
 */

const readline = require('node:readline');
const { createDatabase } = require('./db');

const MCP_PROTOCOL_VERSION = '2024-11-05';

const MCP_TOOLS = [
  {
    name: 'list_applications',
    description: 'Lister et filtrer les candidatures (alternance, job CDI/CDD, stage, freelance) enregistrées dans Alt-Tracker.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['all', 'alternance', 'job', 'stage', 'freelance', 'autre'],
          description: 'Filtrer par type de contrat'
        },
        status: {
          type: 'string',
          enum: ['all', 'draft', 'applied', 'interview', 'technical', 'offer', 'rejected'],
          description: 'Filtrer par statut du pipeline'
        },
        search: {
          type: 'string',
          description: 'Recherche par entreprise, intitulé de poste ou ville'
        },
        due_followup: {
          type: 'boolean',
          description: 'Uniquement les candidatures dont la date de relance est échue'
        }
      }
    }
  },
  {
    name: 'get_application',
    description: 'Récupérer les détails complets et l’historique (timeline) d’une candidature via son ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Identifiant unique de la candidature' }
      },
      required: ['id']
    }
  },
  {
    name: 'create_application',
    description: 'Créer une nouvelle candidature dans la base SQLite Alt-Tracker.',
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Nom de l’entreprise' },
        role: { type: 'string', description: 'Intitulé du poste' },
        type: { type: 'string', enum: ['alternance', 'job', 'stage', 'freelance', 'autre'] },
        status: { type: 'string', enum: ['draft', 'applied', 'interview', 'technical', 'offer', 'rejected'] },
        location: { type: 'string', description: 'Ville ou localisation' },
        work_mode: { type: 'string', enum: ['hybrid', 'onsite', 'remote'] },
        salary: { type: 'string', description: 'Salaire ou rémunération' },
        rhythm: { type: 'string', description: 'Rythme d’alternance ou durée' },
        contact_name: { type: 'string', description: 'Nom du contact recruteur' },
        contact_email: { type: 'string', description: 'Email ou LinkedIn du contact' },
        notes: { type: 'string', description: 'Notes et stack technique' }
      },
      required: ['company', 'role']
    }
  },
  {
    name: 'update_application_status',
    description: 'Mettre à jour le statut d’une candidature dans le pipeline Kanban et ajouter une note au journal.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID de la candidature' },
        status: { type: 'string', enum: ['draft', 'applied', 'interview', 'technical', 'offer', 'rejected'] },
        note: { type: 'string', description: 'Note explicative ajoutée à la timeline' }
      },
      required: ['id', 'status']
    }
  },
  {
    name: 'mark_follow_up_done',
    description: 'Enregistrer une relance recruteur effectuée aujourd’hui et programmer la prochaine relance.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID de la candidature' },
        nextFollowUpDays: { type: 'number', description: 'Jours avant la prochaine relance (défaut: 7)' },
        note: { type: 'string', description: 'Détail de la relance (email, LinkedIn, appel)' }
      },
      required: ['id']
    }
  },
  {
    name: 'get_pipeline_stats',
    description: 'Obtenir les KPIs globaux : total, taux de retour, taux d’entretien, relances prioritaires et performance des CV.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'generate_cover_letter_pdf',
    description: 'Générer une lettre de motivation en PDF et l’enregistrer dans la bibliothèque CV & LM.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Titre du document (ex: LM Alternance Airbus)' },
        content_text: { type: 'string', description: 'Corps complet de la lettre de motivation' },
        version_tag: { type: 'string', description: 'Tag de version (ex: v1.0-MCP)' }
      },
      required: ['label', 'content_text']
    }
  }
];

const MCP_RESOURCES = [
  {
    uri: 'alt-tracker://applications/all',
    name: 'Toutes les candidatures Alt-Tracker',
    description: 'Liste JSON complète des candidatures (alternances, emplois, stages) avec leurs dates et contacts.',
    mimeType: 'application/json'
  },
  {
    uri: 'alt-tracker://stats/summary',
    name: 'Statistiques & KPIs du Pipeline',
    description: 'Taux de retour, taux de conversion en entretien, relances urgentes et répartition par contrat.',
    mimeType: 'application/json'
  },
  {
    uri: 'alt-tracker://documents/list',
    name: 'Bibliothèque de CV & Lettres de motivation',
    description: 'Liste des CV et lettres PDF avec leur taux de succès en entretien.',
    mimeType: 'application/json'
  }
];

const MCP_PROMPTS = [
  {
    name: 'relance-recruteur',
    description: 'Génère un email de relance et un message LinkedIn pour une candidature.',
    arguments: [
      { name: 'company', description: 'Nom de l’entreprise', required: true },
      { name: 'role', description: 'Intitulé du poste', required: false }
    ]
  },
  {
    name: 'audit-pipeline',
    description: 'Analyse complète du pipeline de candidatures et recommandations de relances prioritaires.',
    arguments: []
  },
  {
    name: 'preparation-entretien',
    description: 'Prépare un guide d’entretien technique et RH sur-mesure pour une candidature.',
    arguments: [
      { name: 'company', description: 'Nom de l’entreprise', required: true }
    ]
  }
];

function executeMcpTool(store, name, args = {}) {
  switch (name) {
    case 'list_applications': {
      const items = store.listApplications(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: items.length, applications: items }, null, 2)
          }
        ]
      };
    }
    case 'get_application': {
      const item = store.getApplicationById(args.id);
      if (!item) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Candidature #${args.id} introuvable.` }]
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(item, null, 2) }]
      };
    }
    case 'create_application': {
      const created = store.createApplication(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ message: 'Candidature créée avec succès', application: created }, null, 2)
          }
        ]
      };
    }
    case 'update_application_status': {
      const updated = store.updateApplication(args.id, {
        status: args.status,
        status_note: args.note
      });
      if (!updated) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Candidature #${args.id} introuvable.` }]
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }]
      };
    }
    case 'mark_follow_up_done': {
      const updated = store.markFollowUpDone(args.id, {
        nextFollowUpDays: args.nextFollowUpDays ?? 7,
        note: args.note || 'Relance enregistrée via MCP'
      });
      if (!updated) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Candidature #${args.id} introuvable.` }]
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }]
      };
    }
    case 'get_pipeline_stats': {
      const stats = store.getStats();
      return {
        content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }]
      };
    }
    case 'generate_cover_letter_pdf': {
      const doc = store.createDocument({
        label: args.label,
        doc_type: 'cover_letter',
        version_tag: args.version_tag || 'v1.0-MCP',
        generate_pdf_text: args.content_text,
        notes: 'Document PDF généré via Model Context Protocol (MCP)'
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                message: 'Lettre de motivation PDF créée',
                document: doc,
                view_url: `/api/documents/${doc.id}/view`
              },
              null,
              2
            )
          }
        ]
      };
    }
    default:
      throw new Error(`Outil MCP inconnu : ${name}`);
  }
}

function handleMcpRequest(store, rpc = {}) {
  const { jsonrpc = '2.0', id, method, params = {} } = rpc;

  try {
    if (method === 'initialize') {
      return {
        jsonrpc,
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: {
            name: 'alt-tracker-mcp-server',
            version: '1.0.0'
          },
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false }
          }
        }
      };
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'ping') {
      return { jsonrpc, id, result: {} };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc,
        id,
        result: { tools: MCP_TOOLS }
      };
    }

    if (method === 'tools/call') {
      const toolResult = executeMcpTool(store, params.name, params.arguments || {});
      return {
        jsonrpc,
        id,
        result: toolResult
      };
    }

    if (method === 'resources/list') {
      return {
        jsonrpc,
        id,
        result: { resources: MCP_RESOURCES }
      };
    }

    if (method === 'resources/read') {
      const uri = params.uri;
      let data = null;
      if (uri === 'alt-tracker://applications/all') {
        data = store.listApplications({});
      } else if (uri === 'alt-tracker://stats/summary') {
        data = store.getStats();
      } else if (uri === 'alt-tracker://documents/list') {
        data = store.listDocuments();
      } else {
        throw new Error(`Ressource MCP introuvable : ${uri}`);
      }
      return {
        jsonrpc,
        id,
        result: {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2)
            }
          ]
        }
      };
    }

    if (method === 'prompts/list') {
      return {
        jsonrpc,
        id,
        result: { prompts: MCP_PROMPTS }
      };
    }

    if (method === 'prompts/get') {
      const name = params.name;
      const args = params.arguments || {};
      return {
        jsonrpc,
        id,
        result: {
          description: `Prompt MCP : ${name}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text:
                  name === 'relance-recruteur'
                    ? `Rédige un email de relance et un message LinkedIn pour ma candidature chez ${args.company || 'l’entreprise'} (${args.role || 'poste ciblé'}).`
                    : name === 'preparation-entretien'
                      ? `Prépare-moi aux questions techniques et RH pour mon entretien chez ${args.company || 'l’entreprise'}.`
                      : `Analyse mon pipeline de candidatures Alt-Tracker et indique les actions prioritaires.`
              }
            }
          ]
        }
      };
    }

    return {
      jsonrpc,
      id: id ?? null,
      error: {
        code: -32601,
        message: `Méthode MCP non supportée : ${method}`
      }
    };
  } catch (err) {
    return {
      jsonrpc,
      id: id ?? null,
      error: {
        code: -32603,
        message: err.message
      }
    };
  }
}

async function probeExternalMcpServer(endpointUrl, authToken = '', localStore = null) {
  const cleanUrl = String(endpointUrl || '').trim();
  if (!cleanUrl) throw new Error('URL du serveur MCP requise');

  // If pointing to our own built-in /api/mcp endpoint, resolve directly in-memory so it never fails on port/network
  if (localStore && (cleanUrl.endsWith('/api/mcp') || cleanUrl === 'internal://alt-tracker')) {
    return {
      status: 'connected',
      serverInfo: { name: 'alt-tracker-mcp-server', version: '1.0.0' },
      tools: MCP_TOOLS,
      resources: MCP_RESOURCES
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (authToken && authToken.trim()) {
    headers.Authorization = `Bearer ${authToken.trim()}`;
  }

  const res = await fetch(cleanUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    })
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = await res.json();
  const tools = (body && body.result && Array.isArray(body.result.tools)) ? body.result.tools : [];
  return {
    status: 'connected',
    tools,
    resources: []
  };
}

// Standalone Stdio MCP Server entry point (`node src/mcp-server.js`)
if (require.main === module) {
  const store = createDatabase();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const rpc = JSON.parse(trimmed);
      const response = handleMcpRequest(store, rpc);
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: `Parse error: ${err.message}` }
        }) + '\n'
      );
    }
  });
}

module.exports = {
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  MCP_RESOURCES,
  MCP_PROMPTS,
  handleMcpRequest,
  probeExternalMcpServer
};
