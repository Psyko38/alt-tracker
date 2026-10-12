#!/usr/bin/env node
/**
 * Alt-Tracker — Full-App Model Context Protocol (MCP) Server & Unified Tool Engine
 * Covers 100% of Alt-Tracker capabilities for both:
 * 1. External AI Agents via Stdio (`node src/mcp-server.js`) or HTTP JSON-RPC 2.0 (`POST /api/mcp`)
 * 2. Internal AI Studio Copilot (`src/ai-agent.js`)
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { createDatabase, STATUS_LABELS, TYPE_LABELS } = require('./db');

const MCP_PROTOCOL_VERSION = '2024-11-05';

const MCP_TOOLS = [
  // --- 1. Candidatures (CRUD complet & Pipeline Kanban) ---
  {
    name: 'list_applications',
    category: 'Candidatures',
    description:
      'Lister, rechercher, filtrer et trier les candidatures (alternance, job CDI/CDD, stage, freelance, autre).',
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
          description: 'Mot-clé (entreprise, poste, ville, contact, notes)'
        },
        due_followup: {
          type: 'boolean',
          description: 'Si true, retourne uniquement les candidatures à relancer'
        },
        favorite: {
          type: 'boolean',
          description: 'Si true, retourne uniquement les candidatures favorites'
        },
        sort: {
          type: 'string',
          enum: ['updated_desc', 'applied_desc', 'followup_asc', 'priority_desc', 'company_asc'],
          description: 'Ordre de tri'
        }
      }
    }
  },
  {
    name: 'get_application',
    category: 'Candidatures',
    description:
      'Récupérer la fiche complète d’une candidature ainsi que tout son journal d’événements (timeline) via son ID.',
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
    category: 'Candidatures',
    description:
      'Créer une nouvelle candidature complète dans Alt-Tracker avec dates, salaire, rythme, contact et documents liés.',
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Nom de l’entreprise' },
        role: { type: 'string', description: 'Intitulé du poste' },
        type: { type: 'string', enum: ['alternance', 'job', 'stage', 'freelance', 'autre'] },
        status: { type: 'string', enum: ['draft', 'applied', 'interview', 'technical', 'offer', 'rejected'] },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        location: { type: 'string', description: 'Ville ou localisation' },
        work_mode: { type: 'string', enum: ['hybrid', 'onsite', 'remote'] },
        salary: { type: 'string', description: 'Salaire ou rémunération' },
        rhythm: { type: 'string', description: 'Rythme d’alternance ou durée' },
        job_url: { type: 'string', description: 'URL de l’offre' },
        applied_date: { type: 'string', description: 'Date d’envoi YYYY-MM-DD' },
        follow_up_date: { type: 'string', description: 'Date de relance prévue YYYY-MM-DD' },
        interview_date: { type: 'string', description: 'Date d’entretien YYYY-MM-DDTHH:mm' },
        contact_name: { type: 'string', description: 'Nom du recruteur / contact' },
        contact_role: { type: 'string', description: 'Fonction du contact' },
        contact_email: { type: 'string', description: 'Email ou LinkedIn du contact' },
        contact_phone: { type: 'string', description: 'Téléphone du contact' },
        cv_version: { type: 'string', description: 'Version du CV envoyée' },
        cl_version: { type: 'string', description: 'Version de la lettre de motivation' },
        document_id: { type: 'number', description: 'ID du document lié dans la bibliothèque' },
        notes: { type: 'string', description: 'Notes, stack technique, retours' },
        favorite: { type: 'boolean', description: 'Marquer en favori' }
      },
      required: ['company', 'role']
    }
  },
  {
    name: 'update_application',
    category: 'Candidatures',
    description:
      'Mettre à jour n’importe quel champ d’une candidature existante (entreprise, poste, statut, dates, contact, salaire, rythme, notes, CV, favori).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID de la candidature à modifier' },
        company: { type: 'string' },
        role: { type: 'string' },
        type: { type: 'string', enum: ['alternance', 'job', 'stage', 'freelance', 'autre'] },
        status: { type: 'string', enum: ['draft', 'applied', 'interview', 'technical', 'offer', 'rejected'] },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        location: { type: 'string' },
        work_mode: { type: 'string', enum: ['hybrid', 'onsite', 'remote'] },
        salary: { type: 'string' },
        rhythm: { type: 'string' },
        job_url: { type: 'string' },
        applied_date: { type: 'string' },
        follow_up_date: { type: 'string' },
        interview_date: { type: 'string' },
        contact_name: { type: 'string' },
        contact_role: { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        cv_version: { type: 'string' },
        cl_version: { type: 'string' },
        document_id: { type: 'number' },
        notes: { type: 'string' },
        favorite: { type: 'boolean' },
        status_note: { type: 'string', description: 'Note enregistrée dans la timeline si le statut change' }
      },
      required: ['id']
    }
  },
  {
    name: 'update_application_status',
    category: 'Candidatures',
    description:
      'Déplacer rapidement une candidature vers une nouvelle colonne du Kanban et journaliser le changement.',
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
    name: 'toggle_application_favorite',
    category: 'Candidatures',
    description: 'Ajouter ou retirer une candidature des favoris (étoile).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID de la candidature' },
        favorite: { type: 'boolean', description: 'true = favori, false = standard (optionnel : inverse si omis)' }
      },
      required: ['id']
    }
  },
  {
    name: 'delete_application',
    category: 'Candidatures',
    description: 'Supprimer définitivement une candidature et son historique.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID de la candidature à supprimer' }
      },
      required: ['id']
    }
  },

  // --- 2. Relances & Journal Timeline ---
  {
    name: 'mark_follow_up_done',
    category: 'Relances & Timeline',
    description:
      'Enregistrer une relance recruteur effectuée aujourd’hui et reprogrammer automatiquement la prochaine échéance.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID de la candidature' },
        nextFollowUpDays: { type: 'number', description: 'Jours avant la prochaine relance (défaut: 7)' },
        note: { type: 'string', description: 'Détail de la relance (email, LinkedIn, téléphone)' }
      },
      required: ['id']
    }
  },
  {
    name: 'add_timeline_event',
    category: 'Relances & Timeline',
    description:
      'Ajouter un événement personnalisé (entretien, test technique, appel, note, offre) à la timeline d’une candidature.',
    inputSchema: {
      type: 'object',
      properties: {
        application_id: { type: 'number', description: 'ID de la candidature' },
        event_type: {
          type: 'string',
          enum: ['note', 'interview', 'follow_up', 'status_change', 'offer', 'created'],
          description: 'Type d’événement'
        },
        title: { type: 'string', description: 'Titre de l’étape (ex: Entretien RH avec Claire Moreau)' },
        description: { type: 'string', description: 'Compte-rendu ou détails complémentaires' },
        event_date: { type: 'string', description: 'Date ISO optionnelle' }
      },
      required: ['application_id', 'title']
    }
  },

  // --- 3. Bibliothèque de Documents (CV, Lettres de motivation, Portfolios) ---
  {
    name: 'list_documents',
    category: 'Documents CV & LM',
    description:
      'Lister tous les documents de la bibliothèque (CV, lettres de motivation, portfolios) avec leur nombre d’utilisations et taux d’entretien.',
    inputSchema: {
      type: 'object',
      properties: {
        doc_type: {
          type: 'string',
          enum: ['all', 'cv', 'cover_letter', 'portfolio', 'other'],
          description: 'Filtrer par catégorie de document'
        }
      }
    }
  },
  {
    name: 'get_document',
    category: 'Documents CV & LM',
    description: 'Obtenir les détails, métadonnées et URLs de visualisation/téléchargement d’un document par ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID du document' }
      },
      required: ['id']
    }
  },
  {
    name: 'create_document',
    category: 'Documents CV & LM',
    description:
      'Ajouter un nouveau document (CV, lettre de motivation, portfolio) dans la bibliothèque, avec génération automatique de fichier PDF si generate_pdf_text est fourni.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Nom du document' },
        doc_type: { type: 'string', enum: ['cv', 'cover_letter', 'portfolio', 'other'] },
        version_tag: { type: 'string', description: 'Version (ex: v2.1)' },
        target_type: { type: 'string', enum: ['alternance', 'job', 'stage', 'freelance', 'autre'] },
        external_url: { type: 'string', description: 'Lien externe (GitHub, Drive, Portfolio)' },
        notes: { type: 'string', description: 'Notes sur cette version' },
        generate_pdf_text: {
          type: 'string',
          description: 'Contenu texte complet à compiler immédiatement en fichier PDF local'
        }
      },
      required: ['label']
    }
  },
  {
    name: 'update_document',
    category: 'Documents CV & LM',
    description: 'Modifier les métadonnées, la version, les notes ou régénérer le PDF d’un document existant.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID du document' },
        label: { type: 'string' },
        doc_type: { type: 'string', enum: ['cv', 'cover_letter', 'portfolio', 'other'] },
        version_tag: { type: 'string' },
        external_url: { type: 'string' },
        notes: { type: 'string' },
        generate_pdf_text: { type: 'string', description: 'Nouveau contenu texte à compiler en PDF' }
      },
      required: ['id']
    }
  },
  {
    name: 'delete_document',
    category: 'Documents CV & LM',
    description: 'Supprimer un document de la bibliothèque CV & LM.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID du document à supprimer' }
      },
      required: ['id']
    }
  },
  {
    name: 'generate_cover_letter_pdf',
    category: 'Documents CV & LM',
    description:
      'Générer une lettre de motivation en PDF dans la bibliothèque et l’associer optionnellement à une candidature.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Titre du document (ex: LM Alternance Airbus)' },
        content_text: { type: 'string', description: 'Corps intégral de la lettre de motivation' },
        version_tag: { type: 'string', description: 'Tag de version (ex: IA-v1)' },
        application_id: {
          type: 'number',
          description: 'ID optionnel de la candidature à laquelle associer cette lettre'
        }
      },
      required: ['label', 'content_text']
    }
  },

  // --- 4. Statistiques & Analytics ---
  {
    name: 'get_pipeline_stats',
    category: 'Statistiques & Rapports',
    description:
      'Obtenir toutes les statistiques du tableau de bord : total, envois, actifs, taux de retour, taux d’entretien, répartition par statut/contrat, relances urgentes, entretiens à venir et performance des CV.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // --- 5. Page de Garde PDF & Exports / Imports ---
  {
    name: 'get_pdf_cover_settings',
    category: 'Page de Garde & Exports PDF',
    description:
      'Lire la configuration actuelle de la Page de Garde officielle des exports PDF (titre, sous-titre, candidat, école, année, contrat recherché, note de synthèse, thème couleur).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'update_pdf_cover_settings',
    category: 'Page de Garde & Exports PDF',
    description:
      'Personnaliser et enregistrer la Page de Garde officielle des exports PDF (activer/désactiver la page de garde, modifier le titre, le nom du candidat, l’école/formation, l’année universitaire, le contrat visé, la note de synthèse ou le thème Material 3).',
    inputSchema: {
      type: 'object',
      properties: {
        include_cover_page: { type: 'boolean', description: 'Activer ou désactiver la Page de Garde en page 1' },
        report_title: { type: 'string', description: 'Grand titre de la page de garde' },
        report_subtitle: { type: 'string', description: 'Sous-titre du rapport' },
        candidate_name: { type: 'string', description: 'Prénom et Nom du candidat' },
        school_or_program: { type: 'string', description: 'École, université, CFA ou formation' },
        academic_year: { type: 'string', description: 'Année scolaire / période (ex: 2026 - 2027)' },
        target_contract: { type: 'string', description: 'Contrat et objectif recherché' },
        cover_note: { type: 'string', description: 'Note de synthèse affichée au bas de la page de garde' },
        accent_theme: {
          type: 'string',
          enum: ['iris', 'emerald', 'ocean', 'terracotta', 'cherry'],
          description: 'Thème de couleur Material Design 3 du PDF'
        },
        show_kpi_boxes: { type: 'boolean', description: 'Afficher les 4 cartes KPI sur la page de garde' }
      }
    }
  },
  {
    name: 'export_applications_pdf_report',
    category: 'Page de Garde & Exports PDF',
    description:
      'Générer le rapport PDF officiel Paysage A4 (avec Page de Garde et tableau des envois) et l’enregistrer optionnellement dans la bibliothèque de documents pour l’ouvrir dans la page.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['all', 'alternance', 'job', 'stage', 'freelance', 'autre'] },
        status: { type: 'string', enum: ['all', 'draft', 'applied', 'interview', 'technical', 'offer', 'rejected'] },
        include_cover_page: { type: 'boolean', description: 'Inclure la page de garde officielle' },
        report_title: { type: 'string', description: 'Titre personnalisé pour cet export' },
        accent_theme: { type: 'string', enum: ['iris', 'emerald', 'ocean', 'terracotta', 'cherry'] },
        save_to_library: {
          type: 'boolean',
          description: 'Si true (défaut), enregistre aussi le rapport PDF dans la bibliothèque Documents pour aperçu immédiat'
        }
      }
    }
  },
  {
    name: 'export_applications_data',
    category: 'Page de Garde & Exports PDF',
    description: 'Exporter toutes les candidatures au format CSV ou JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['csv', 'json'], description: 'Format d’export souhaité' }
      }
    }
  },
  {
    name: 'import_applications_data',
    category: 'Page de Garde & Exports PDF',
    description: 'Importer un lot de candidatures à partir d’un tableau JSON ou d’un contenu CSV.',
    inputSchema: {
      type: 'object',
      properties: {
        applications: {
          type: 'array',
          description: 'Liste d’objets candidatures à importer',
          items: {
            type: 'object',
            properties: {
              company: { type: 'string' },
              role: { type: 'string' },
              type: { type: 'string' },
              status: { type: 'string' },
              location: { type: 'string' }
            }
          }
        },
        csv: { type: 'string', description: 'Contenu CSV brut à importer' }
      }
    }
  },

  // --- 6. Configuration Profil IA & Connecteurs ---
  {
    name: 'get_or_update_ai_profile',
    category: 'Profil IA & Système',
    description:
      'Lire ou mettre à jour le profil candidat (nom, compétences, bio) utilisé par l’IA ainsi que la liste des connecteurs MCP.',
    inputSchema: {
      type: 'object',
      properties: {
        candidate_name: { type: 'string', description: 'Nouveau nom du candidat (optionnel)' },
        candidate_profile: { type: 'string', description: 'Nouveau résumé de profil / stack technique (optionnel)' }
      }
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
  },
  {
    uri: 'alt-tracker://settings/pdf-cover',
    name: 'Configuration de la Page de Garde PDF',
    description: 'Paramètres actuels de la page de garde des rapports PDF (titre, candidat, école, thème).',
    mimeType: 'application/json'
  },
  {
    uri: 'alt-tracker://settings/ai-profile',
    name: 'Profil Candidat & Paramètres IA',
    description: 'Profil du candidat et connecteurs MCP actifs.',
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
    arguments: [{ name: 'company', description: 'Nom de l’entreprise', required: true }]
  },
  {
    name: 'generer-dossier-pdf',
    description: 'Personnalise la page de garde et génère le dossier PDF officiel des candidatures.',
    arguments: [
      { name: 'school', description: 'Nom de l’école ou formation', required: false },
      { name: 'theme', description: 'Thème couleur (iris, emerald, ocean, terracotta, cherry)', required: false }
    ]
  }
];

/**
 * Executes any of the 22 MCP tools and returns rich metadata for both:
 * - Standard MCP `tools/call` responses (`{ content, isError }`)
 * - Internal AI Studio Agent (`{ actionLabel, mutated, documentCreated, data }`)
 */
function executeMcpToolWithMeta(store, name, args = {}) {
  switch (name) {
    case 'list_applications': {
      const items = store.listApplications({
        type: args.type || 'all',
        status: args.status || 'all',
        search: args.search || '',
        due_followup: args.due_followup ? 'true' : undefined,
        favorite: args.favorite ? 'true' : undefined,
        sort: args.sort || 'updated_desc'
      });
      const payload = { count: items.length, applications: items };
      return {
        actionLabel: `MCP · Recherche candidatures (${items.length} résultat(s))`,
        mutated: false,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      };
    }

    case 'get_application': {
      const item = store.getApplicationById(args.id);
      if (!item) {
        return {
          isError: true,
          actionLabel: `MCP · Candidature #${args.id} introuvable`,
          mutated: false,
          data: { error: `Candidature #${args.id} introuvable.` },
          content: [{ type: 'text', text: `Candidature #${args.id} introuvable.` }]
        };
      }
      return {
        actionLabel: `MCP · Lecture fiche ${item.company}`,
        mutated: false,
        data: item,
        content: [{ type: 'text', text: JSON.stringify(item, null, 2) }]
      };
    }

    case 'create_application': {
      const created = store.createApplication(args);
      const payload = { message: 'Candidature créée avec succès', application: created };
      return {
        actionLabel: `MCP · Candidature créée : ${created.company} — ${created.role}`,
        mutated: true,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      };
    }

    case 'update_application': {
      const updated = store.updateApplication(args.id, args);
      if (!updated) {
        return {
          isError: true,
          actionLabel: `MCP · Candidature #${args.id} introuvable`,
          mutated: false,
          data: { error: `Candidature #${args.id} introuvable.` },
          content: [{ type: 'text', text: `Candidature #${args.id} introuvable.` }]
        };
      }
      return {
        actionLabel: `MCP · Candidature mise à jour : ${updated.company}`,
        mutated: true,
        data: updated,
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }]
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
          actionLabel: `MCP · Candidature #${args.id} introuvable`,
          mutated: false,
          data: { error: `Candidature #${args.id} introuvable.` },
          content: [{ type: 'text', text: `Candidature #${args.id} introuvable.` }]
        };
      }
      return {
        actionLabel: `MCP · Statut ${updated.company} → ${STATUS_LABELS[updated.status] || updated.status}`,
        mutated: true,
        data: updated,
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }]
      };
    }

    case 'toggle_application_favorite': {
      const existing = store.getApplicationById(args.id);
      if (!existing) {
        return {
          isError: true,
          actionLabel: `MCP · Candidature #${args.id} introuvable`,
          mutated: false,
          data: { error: `Candidature #${args.id} introuvable.` },
          content: [{ type: 'text', text: `Candidature #${args.id} introuvable.` }]
        };
      }
      const nextFav = args.favorite !== undefined ? Boolean(args.favorite) : !Boolean(existing.favorite);
      const updated = store.updateApplication(args.id, { favorite: nextFav });
      return {
        actionLabel: `MCP · Favori ${nextFav ? 'activé' : 'retiré'} pour ${updated.company}`,
        mutated: true,
        data: updated,
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }]
      };
    }

    case 'delete_application': {
      const existing = store.getApplicationById(args.id);
      const ok = store.deleteApplication(args.id);
      if (!ok) {
        return {
          isError: true,
          actionLabel: `MCP · Candidature #${args.id} introuvable`,
          mutated: false,
          data: { error: `Candidature #${args.id} introuvable.` },
          content: [{ type: 'text', text: `Candidature #${args.id} introuvable.` }]
        };
      }
      const payload = { deleted: true, id: args.id, company: existing ? existing.company : undefined };
      return {
        actionLabel: `MCP · Candidature supprimée (${existing ? existing.company : '#' + args.id})`,
        mutated: true,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
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
          actionLabel: `MCP · Candidature #${args.id} introuvable`,
          mutated: false,
          data: { error: `Candidature #${args.id} introuvable.` },
          content: [{ type: 'text', text: `Candidature #${args.id} introuvable.` }]
        };
      }
      return {
        actionLabel: `MCP · Relance validée pour ${updated.company} (+${args.nextFollowUpDays ?? 7}j)`,
        mutated: true,
        data: updated,
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }]
      };
    }

    case 'add_timeline_event': {
      const appId = args.application_id || args.id;
      const updated = store.addApplicationEvent(appId, {
        event_type: args.event_type || 'note',
        title: args.title,
        description: args.description || '',
        event_date: args.event_date
      });
      if (!updated) {
        return {
          isError: true,
          actionLabel: `MCP · Candidature #${appId} introuvable`,
          mutated: false,
          data: { error: `Candidature #${appId} introuvable.` },
          content: [{ type: 'text', text: `Candidature #${appId} introuvable.` }]
        };
      }
      return {
        actionLabel: `MCP · Événement ajouté (${updated.company} : ${args.title})`,
        mutated: true,
        data: updated,
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }]
      };
    }

    case 'list_documents': {
      let docs = store.listDocuments();
      if (args.doc_type && args.doc_type !== 'all') {
        docs = docs.filter((d) => d.doc_type === args.doc_type);
      }
      const payload = { count: docs.length, documents: docs };
      return {
        actionLabel: `MCP · Consultation bibliothèque (${docs.length} document(s))`,
        mutated: false,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      };
    }

    case 'get_document': {
      const doc = store.getDocumentById(args.id);
      if (!doc) {
        return {
          isError: true,
          actionLabel: `MCP · Document #${args.id} introuvable`,
          mutated: false,
          data: { error: `Document #${args.id} introuvable.` },
          content: [{ type: 'text', text: `Document #${args.id} introuvable.` }]
        };
      }
      const payload = {
        ...doc,
        view_url: `/api/documents/${doc.id}/view`,
        download_url: `/api/documents/${doc.id}/download`
      };
      return {
        actionLabel: `MCP · Lecture document ${doc.label}`,
        mutated: false,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      };
    }

    case 'create_document': {
      const doc = store.createDocument({
        label: args.label,
        doc_type: args.doc_type || 'cv',
        version_tag: args.version_tag || 'v1.0',
        target_type: args.target_type || 'alternance',
        external_url: args.external_url || '',
        notes: args.notes || '',
        generate_pdf_text: args.generate_pdf_text || ''
      });
      return {
        actionLabel: `MCP · Document créé : ${doc.label}`,
        mutated: true,
        documentCreated: doc,
        data: doc,
        content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }]
      };
    }

    case 'update_document': {
      const doc = store.updateDocument(args.id, args);
      if (!doc) {
        return {
          isError: true,
          actionLabel: `MCP · Document #${args.id} introuvable`,
          mutated: false,
          data: { error: `Document #${args.id} introuvable.` },
          content: [{ type: 'text', text: `Document #${args.id} introuvable.` }]
        };
      }
      return {
        actionLabel: `MCP · Document mis à jour : ${doc.label}`,
        mutated: true,
        data: doc,
        content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }]
      };
    }

    case 'delete_document': {
      const ok = store.deleteDocument(args.id);
      if (!ok) {
        return {
          isError: true,
          actionLabel: `MCP · Document #${args.id} introuvable`,
          mutated: false,
          data: { error: `Document #${args.id} introuvable.` },
          content: [{ type: 'text', text: `Document #${args.id} introuvable.` }]
        };
      }
      const payload = { deleted: true, id: args.id };
      return {
        actionLabel: `MCP · Document #${args.id} supprimé`,
        mutated: true,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      };
    }

    case 'generate_cover_letter_pdf':
    case 'save_generated_document': {
      const contentText = args.content_text || args.content || '';
      const doc = store.createDocument({
        label: args.label,
        doc_type: args.doc_type || 'cover_letter',
        version_tag: args.version_tag || 'v1.0-MCP',
        generate_pdf_text: contentText,
        notes: (contentText || 'Document PDF généré via MCP').slice(0, 240)
      });
      if (args.application_id) {
        store.updateApplication(args.application_id, {
          cl_version: `${doc.label} (${doc.version_tag})`,
          document_id: doc.id
        });
      }
      const payload = {
        message: 'Lettre de motivation PDF créée',
        document: doc,
        view_url: `/api/documents/${doc.id}/view`,
        download_url: `/api/documents/${doc.id}/download`
      };
      return {
        actionLabel: `MCP · PDF généré : ${doc.label}`,
        mutated: true,
        documentCreated: doc,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      };
    }

    case 'get_pipeline_stats':
    case 'get_dashboard_stats': {
      const stats = store.getStats();
      return {
        actionLabel: 'MCP · Analyse des statistiques du pipeline',
        mutated: false,
        data: stats,
        content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }]
      };
    }

    case 'get_pdf_cover_settings': {
      const settings = store.getPdfSettings();
      return {
        actionLabel: 'MCP · Lecture configuration Page de Garde PDF',
        mutated: false,
        data: settings,
        content: [{ type: 'text', text: JSON.stringify(settings, null, 2) }]
      };
    }

    case 'update_pdf_cover_settings': {
      const updated = store.savePdfSettings(args);
      return {
        actionLabel: `MCP · Page de Garde PDF mise à jour (${updated.report_title})`,
        mutated: true,
        data: updated,
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }]
      };
    }

    case 'export_applications_pdf_report': {
      const filters = {
        type: args.type || 'all',
        status: args.status || 'all'
      };
      const overrides = {};
      if (args.include_cover_page !== undefined) overrides.include_cover_page = args.include_cover_page;
      if (args.report_title) overrides.report_title = args.report_title;
      if (args.accent_theme) overrides.accent_theme = args.accent_theme;

      const pdfBuffer = store.exportApplicationsPdfBuffer(filters, overrides);
      let createdDoc = null;
      if (args.save_to_library !== false) {
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `Rapport_Candidatures_${dateStr}.pdf`;
        createdDoc = store.createDocument({
          label: args.report_title || `Rapport Officiel des Candidatures (${dateStr})`,
          doc_type: 'other',
          version_tag: 'PDF-A4',
          file_name: fileName,
          mime_type: 'application/pdf',
          file_base64: pdfBuffer.toString('base64'),
          notes: 'Rapport PDF Paysage A4 avec Page de Garde généré via MCP'
        });
      }

      const payload = {
        message: 'Rapport PDF Paysage A4 généré avec succès',
        bytes: pdfBuffer.length,
        preview_url: '/api/export/pdf?inline=1',
        download_url: '/api/export/pdf',
        document: createdDoc
      };
      return {
        actionLabel: 'MCP · Génération du rapport PDF avec Page de Garde',
        mutated: Boolean(createdDoc),
        documentCreated: createdDoc,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      };
    }

    case 'export_applications_data': {
      const format = args.format || 'json';
      if (format === 'csv') {
        const csv = store.exportCsv();
        return {
          actionLabel: 'MCP · Export CSV des candidatures',
          mutated: false,
          data: { format: 'csv', csv },
          content: [{ type: 'text', text: csv }]
        };
      }
      const apps = store.listApplications({});
      const payload = { exported_at: new Date().toISOString(), count: apps.length, applications: apps };
      return {
        actionLabel: `MCP · Export JSON (${apps.length} candidatures)`,
        mutated: false,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      };
    }

    case 'import_applications_data': {
      const imported = store.importApplications({
        applications: args.applications,
        csv: args.csv
      });
      const payload = { imported_count: imported.length, applications: imported };
      return {
        actionLabel: `MCP · Import de ${imported.length} candidature(s)`,
        mutated: imported.length > 0,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      };
    }

    case 'get_or_update_ai_profile': {
      let aiSettings = store.getAiSettings();
      let mutated = false;
      if (args.candidate_name !== undefined || args.candidate_profile !== undefined) {
        aiSettings = store.saveAiSettings({
          candidate_name: args.candidate_name,
          candidate_profile: args.candidate_profile
        });
        mutated = true;
      }
      const payload = {
        candidate_name: aiSettings.candidate_name,
        candidate_profile: aiSettings.candidate_profile,
        model: aiSettings.model,
        base_url: aiSettings.base_url,
        mcp_connectors: store.listMcpConnectors()
      };
      return {
        actionLabel: mutated ? 'MCP · Profil candidat mis à jour' : 'MCP · Lecture profil candidat & connecteurs',
        mutated,
        data: payload,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      };
    }

    default:
      throw new Error(`Outil MCP inconnu : ${name}`);
  }
}

function executeMcpTool(store, name, args = {}) {
  const res = executeMcpToolWithMeta(store, name, args);
  return {
    ...(res.isError ? { isError: true } : {}),
    content: res.content
  };
}

function getOpenAiToolsFromMcp() {
  return MCP_TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema
    }
  }));
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
            version: '2.0.0'
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
      } else if (uri === 'alt-tracker://settings/pdf-cover') {
        data = store.getPdfSettings();
      } else if (uri === 'alt-tracker://settings/ai-profile') {
        const s = store.getAiSettings();
        data = {
          candidate_name: s.candidate_name,
          candidate_profile: s.candidate_profile,
          model: s.model,
          connectors: store.listMcpConnectors()
        };
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
                      : name === 'generer-dossier-pdf'
                        ? `Mets à jour la page de garde PDF (école: ${args.school || 'Formation Ingénieur'}, thème: ${args.theme || 'iris'}) et génère le rapport PDF officiel des candidatures.`
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

  if (localStore && (cleanUrl.endsWith('/api/mcp') || cleanUrl === 'internal://alt-tracker')) {
    return {
      status: 'connected',
      serverInfo: { name: 'alt-tracker-mcp-server', version: '2.0.0' },
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
  const tools = body && body.result && Array.isArray(body.result.tools) ? body.result.tools : [];
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
  executeMcpTool,
  executeMcpToolWithMeta,
  getOpenAiToolsFromMcp,
  handleMcpRequest,
  probeExternalMcpServer
};
