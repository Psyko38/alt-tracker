const { STATUS_LABELS, TYPE_LABELS } = require('./db');
const { executeMcpToolWithMeta, getOpenAiToolsFromMcp, MCP_TOOLS } = require('./mcp-server');

function executeAgentTool(store, toolName, args = {}) {
  try {
    return executeMcpToolWithMeta(store, toolName, args);
  } catch (err) {
    return {
      actionLabel: `MCP · Erreur outil (${toolName})`,
      mutated: false,
      data: { error: err.message }
    };
  }
}

function isLocalEndpoint(baseUrl) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.)/i.test(baseUrl || '');
}

async function callOpenAICompatible(settings, messages, useTools = true) {
  const baseUrl = (settings.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const apiKey = settings.api_key || (isLocalEndpoint(baseUrl) ? 'ollama' : '');

  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body = {
    model: settings.model || 'gpt-4o-mini',
    messages,
    temperature: 0.5
  };

  if (useTools) {
    body.tools = getOpenAiToolsFromMcp();
    body.tool_choice = 'auto';
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (useTools && (res.status === 400 || res.status === 422) && /tool|function/i.test(errText)) {
      return callOpenAICompatible(settings, messages, false);
    }
    throw new Error(`API OpenAI (${res.status}) : ${errText.slice(0, 220)}`);
  }

  return res.json();
}

function parseJobOfferHeuristic(rawText) {
  const text = String(rawText || '').trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let type = 'alternance';
  if (/\b(cdi|cdd|full[- ]?time)\b/i.test(text) && !/\b(alternance|apprentissage|apprenti|contrat pro)\b/i.test(text)) {
    type = 'job';
  } else if (/\b(stage|stagiaire|internship)\b/i.test(text) && !/\b(alternance|apprentissage)\b/i.test(text)) {
    type = 'stage';
  } else if (/\b(freelance|mission|ind[eé]pendant|tjm)\b/i.test(text)) {
    type = 'freelance';
  }

  let work_mode = 'hybrid';
  if (/\b(full[- ]?remote|100%\s*t[eé]l[eé]travail|t[eé]l[eé]travail complet)\b/i.test(text)) {
    work_mode = 'remote';
  } else if (/\b(pr[eé]sentiel|sur site)\b/i.test(text) && !/\b(hybride|t[eé]l[eé]travail|remote)\b/i.test(text)) {
    work_mode = 'onsite';
  }

  const companyMatch =
    text.match(/(?:entreprise|soci[eé]t[eé]|chez|company|client)\s*[:\-–]\s*([^\n,;]+)/i) ||
    text.match(/\bchez\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9 &._-]{1,35})/);
  const roleMatch = text.match(/(?:poste|intitul[eé]|r[oô]le|offre|titre)\s*[:\-–]\s*([^\n]+)/i);
  const locMatch =
    text.match(/(?:lieu|localisation|ville|bas[eé] [aà])\s*[:\-–]\s*([^\n,;]+)/i) ||
    text.match(/\b(Paris|Lyon|Toulouse|Nantes|Bordeaux|Lille|Marseille|Rennes|Montpellier|Strasbourg|Grenoble|Nice)\b/i);
  const salaryMatch = text.match(/(\d[\d\s.,]*\s*(?:€|euros?|k€)\s*(?:\/\s*(?:mois|an|jour)|brut)?)/i);
  const rhythmMatch =
    text.match(/(?:rythme|dur[eé]e)\s*[:\-–]\s*([^\n]+)/i) ||
    text.match(/(\d\s*(?:jours?|semaines?|mois)\s*\/\s*\d\s*(?:jours?|semaines?|mois))/i);
  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const urlMatch = text.match(/(https?:\/\/[^\s)]+)/i);

  const company = companyMatch ? companyMatch[1].trim() : lines[1] && lines[1].length < 45 ? lines[1] : 'Entreprise à préciser';
  const role = roleMatch ? roleMatch[1].trim() : lines[0] ? lines[0].slice(0, 85) : 'Poste à préciser';

  return {
    company,
    role,
    type,
    status: 'draft',
    priority: 'high',
    location: locMatch ? locMatch[1].trim() : '',
    work_mode,
    salary: salaryMatch ? salaryMatch[1].trim() : '',
    rhythm: rhythmMatch ? rhythmMatch[1].trim() : '',
    job_url: urlMatch ? urlMatch[1].trim() : '',
    contact_name: '',
    contact_email: emailMatch ? emailMatch[1].trim() : '',
    notes: text.slice(0, 600)
  };
}

function runLocalFallbackAgent(store, userPrompt, focusedApp, settings) {
  const promptLower = (userPrompt || '').toLowerCase();
  const stats = store.getStats();
  const apps = store.listApplications({});
  const targetApp = focusedApp || apps.find((a) => promptLower.includes(a.company.toLowerCase())) || apps[0] || null;
  const actionsExecuted = [];
  const candidateName = settings.candidate_name || 'Matteo';

  // 1. Creation intent in natural language
  const createMatch = userPrompt.match(
    /(?:ajoute|cr[eé]e|enregistre)\s+(?:une\s+)?candidature.*?(?:chez|pour)\s+([A-Za-zÀ-ÿ0-9 &._-]+?)(?:\s+comme|\s+en tant que|\s+pour le poste de|\s+au poste de|\s*[:\-]\s*|$)(.*)/i
  );
  if (createMatch && createMatch[1]) {
    const company = createMatch[1].trim();
    const role = (createMatch[2] || '').trim() || 'Développeur Fullstack (Alternance)';
    const type = /stage/i.test(userPrompt) ? 'stage' : /cdi|cdd|job/i.test(userPrompt) ? 'job' : 'alternance';
    const res = executeAgentTool(store, 'create_application', {
      company,
      role,
      type,
      status: 'applied',
      priority: 'high'
    });
    actionsExecuted.push(res.actionLabel);
    return {
      reply: `J’ai créé la candidature chez **${company}** pour le poste de **${role}** (${TYPE_LABELS[type] || type}).\n\n- **Statut** : Envoyée\n- **Date d’envoi** : Aujourd’hui\n\nVous pouvez la retrouver dans votre **Kanban** et votre **Liste**.`,
      actions: actionsExecuted,
      mutated: true
    };
  }

  // 2. PDF Report / Cover Page intent
  if (/rapport pdf|liste.*pdf|page de garde|dossier pdf/i.test(promptLower) && !/lettre de motivation/i.test(promptLower)) {
    const res = executeAgentTool(store, 'export_applications_pdf_report', {
      include_cover_page: true,
      save_to_library: true
    });
    actionsExecuted.push(res.actionLabel);
    const coverSettings = store.getPdfSettings();
    return {
      reply:
        `### 📄 Dossier PDF Officiel généré avec Page de Garde\n\n` +
        `Votre rapport PDF au format **Paysage A4** a été généré via le moteur MCP :\n\n` +
        `| Paramètre Page de Garde | Valeur |\n|---|---|\n` +
        `| **Titre** | ${coverSettings.report_title} |\n` +
        `| **Candidat** | ${coverSettings.candidate_name} |\n` +
        `| **École / Formation** | ${coverSettings.school_or_program} |\n` +
        `| **Période** | ${coverSettings.academic_year} |\n` +
        `| **Candidatures incluses** | **${apps.length}** |\n\n` +
        `Cliquez sur le bouton ci-dessous pour **visualiser le rapport PDF et sa page de garde directement dans la page**.`,
      actions: actionsExecuted,
      mutated: true,
      documentCreated: res.documentCreated
    };
  }

  // 3. Follow-up email generation
  if (/relance|relancer|mail|email|message linkedin/i.test(promptLower)) {
    const company = targetApp ? targetApp.company : '[Nom de l’entreprise]';
    const role = targetApp ? targetApp.role : '[Intitulé du poste]';
    const contact = targetApp && targetApp.contact_name ? targetApp.contact_name : 'Madame, Monsieur';
    const appliedDate = targetApp && targetApp.applied_date ? `le ${targetApp.applied_date}` : 'récemment';
    const typeLabel = targetApp ? (TYPE_LABELS[targetApp.type] || targetApp.type).toLowerCase() : 'alternance';

    return {
      reply: `Voici une proposition d’email de relance personnalisé pour **${company}** (${role}) :\n\n---\n**Objet :** Suivi de ma candidature — ${role} (${candidateName})\n\nBonjour ${contact},\n\nJe me permets de revenir vers vous suite à ma candidature envoyée ${appliedDate} pour le poste de **${role}** (${typeLabel}) au sein de **${company}**.\n\nToujours très enthousiaste à l’idée de contribuer à vos projets techniques (${settings.candidate_profile || 'développement Fullstack Node.js & interfaces web modernes'}), je souhaitais savoir si vous aviez eu l’occasion d’examiner mon profil.\n\nJe reste bien entendu à votre entière disposition pour un premier échange téléphonique ou technique à votre convenance.\n\nTrès belle journée,\n\n**${candidateName}**`,
      actions: actionsExecuted,
      mutated: false
    };
  }

  // 4. Cover letter generation
  if (/lettre de motivation|lm\b|pitch|motivation/i.test(promptLower)) {
    const company = targetApp ? targetApp.company : 'votre entreprise';
    const role = targetApp ? targetApp.role : 'Développeur Fullstack';
    const rhythm =
      targetApp && targetApp.rhythm ? `Mon rythme (${targetApp.rhythm}) me permet une implication continue sur vos sprints.` : '';

    const letterContent = [
      `Objet : Candidature au poste de ${role} - ${candidateName}`,
      '',
      `Madame, Monsieur,`,
      '',
      `Passionne par le developpement logiciel et l'ingenierie web moderne, je vous soumets ma candidature pour rejoindre ${company} en tant que ${role}.`,
      '',
      `Au cours de mes projets recents, j'ai concu et deploye des applications web completes en Node.js, Express et SQLite en appliquant les standards Google Material Design 3.0 et des suites de tests automatises.`,
      '',
      `Rejoindre les equipes de ${company} represente pour moi l'opportunite ideale de mettre ma rigueur technique, mon autonomie et ma capacite d'apprentissage rapide au service de vos produits. ${rhythm}`,
      '',
      `Je serais ravi d'echanger avec vous lors d'un entretien afin de vous presenter mes realisations concretes.`,
      '',
      `Je vous prie d'agreer, Madame, Monsieur, l'expression de mes salutations distinguees.`,
      '',
      candidateName
    ].join('\n');

    let savedDoc = null;
    if (/enregistre|sauvegarde|pdf/i.test(promptLower) || targetApp) {
      const toolRes = executeAgentTool(store, 'generate_cover_letter_pdf', {
        label: `LM — ${company} (${role.slice(0, 28)})`,
        version_tag: 'IA-v1',
        content_text: letterContent,
        application_id: targetApp ? targetApp.id : undefined
      });
      actionsExecuted.push(toolRes.actionLabel);
      savedDoc = toolRes.documentCreated;
    }

    return {
      reply: `Voici une lettre de motivation sur-mesure pour **${company}** (${role}) :\n\n\`\`\`text\n${letterContent}\n\`\`\`\n\n${savedDoc ? `✅ **Je l’ai également générée en PDF via MCP et ajoutée à votre bibliothèque CV & LM** sous le nom **« ${savedDoc.label} »**.` : ''}`,
      actions: actionsExecuted,
      mutated: Boolean(savedDoc),
      documentCreated: savedDoc
    };
  }

  // 5. Interview coaching
  if (/entretien|coach|question|pr[eé]parer|technique/i.test(promptLower)) {
    const company = targetApp ? targetApp.company : 'l’entreprise';
    const role = targetApp ? targetApp.role : 'Développeur Fullstack Node.js';
    return {
      reply: `### 🎯 Préparation d’entretien — ${company} (${role})\n\nVoici les **5 questions clés** auxquelles vous préparer :\n\n1. **Motivation & Fit Entreprise** : *« Pourquoi avoir choisi ${company} pour votre ${targetApp ? TYPE_LABELS[targetApp.type] || 'contrat' : 'alternance'} et qu’est-ce qui vous attire dans notre produit ? »*\n   - 💡 *Conseil* : Mentionnez un aspect précis de leur stack ou de leur culture d’ingénierie${targetApp && targetApp.notes ? ` (Note enregistrée : "${targetApp.notes}")` : ''}.\n2. **Architecture Node.js & Asynchronisme** : *« Comment fonctionne l’Event Loop de Node.js et comment gérez-vous les erreurs dans une API REST Express ? »*\n3. **Bases de données & Performance** : *« Comment indexez-vous une table SQL / SQLite pour accélérer les recherches et éviter les requêtes N+1 ? »*\n4. **Qualité & Tests** : *« Comment vérifiez-vous qu’une nouvelle fonctionnalité ne casse pas l’existant ? »*\n   - 💡 *Conseil* : Parlez de votre pratique des tests d’intégration automatisés avec \`node:test\`.\n5. **Questions à poser au recruteur en fin d’entretien** :\n   - *« À quoi ressemblent les 30 premiers jours d’un alternant/développeur dans votre équipe ? »*\n   - *« Comment s’organisent les revues de code (Code Reviews) et le mentorat au quotidien ? »*`,
      actions: actionsExecuted,
      mutated: false
    };
  }

  // 6. Pipeline & priorities analysis (default)
  const statTool = executeAgentTool(store, 'get_pipeline_stats', {});
  actionsExecuted.push(statTool.actionLabel);

  const urgentLines =
    stats.urgentFollowUps.length > 0
      ? stats.urgentFollowUps.map((u) => `- **${u.company}** (${u.role}) — Relance prévue le \`${u.follow_up_date}\``).join('\n')
      : '- Aucune relance en retard aujourd’hui 🎉';

  const interviewLines =
    stats.upcomingInterviews.length > 0
      ? stats.upcomingInterviews
          .map((i) => `- **${i.company}** (${i.role}) — Entretien le \`${i.interview_date.replace('T', ' à ')}\``)
          .join('\n')
      : '- Aucun entretien planifié dans les prochains jours';

  return {
    reply:
      `# 📊 Analyse de ton pipeline (${stats.total} candidatures)\n\n` +
      `| Indicateur | Valeur |\n|---|---|\n` +
      `| Candidatures totales | **${stats.total}** |\n` +
      `| Candidatures actives | **${stats.activeCount}** |\n` +
      `| Taux de retour | **${stats.responseRate}%** |\n` +
      `| Taux d’entretien | **${stats.interviewRate}%** |\n` +
      `| Offres reçues | **${stats.offersCount}** |\n\n` +
      `**Répartition par contrat** : ${stats.byType.alternance || 0} Alternance(s) · ${stats.byType.job || 0} Job(s) · ${stats.byType.stage || 0} Stage(s)\n\n` +
      `---\n\n` +
      `## 🔔 Relances prioritaires\n${urgentLines}\n\n` +
      `## 📅 Prochains entretiens\n${interviewLines}`,
    actions: actionsExecuted,
    mutated: false
  };
}

async function runAgentChat(store, { messages = [], focusedApplicationId = null, focusAppId = null }) {
  const settings = store.getAiSettings();
  const stats = store.getStats();
  const targetFocusId = focusAppId || focusedApplicationId;
  const focusedApp = targetFocusId ? store.getApplicationById(targetFocusId) : null;
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  const canUseRemoteLLM = Boolean(settings.api_key && settings.api_key.trim()) || isLocalEndpoint(settings.base_url);

  if (!canUseRemoteLLM) {
    const localResult = runLocalFallbackAgent(store, lastUserMessage, focusedApp, settings);
    return {
      ...localResult,
      provider_mode: 'local_autonomous',
      model: 'Agent Autonome Intégré · Connecté aux 22 Tools MCP'
    };
  }

  const systemPrompt = [
    `Tu es l'Agent IA intégré d'Alt-Tracker, connecté au serveur Model Context Protocol (MCP) complet de l'application (${MCP_TOOLS.length} outils couvrant 100% de l'application).`,
    `Date du jour : ${new Date().toISOString().slice(0, 10)}.`,
    `Candidat : ${settings.candidate_name} — ${settings.candidate_profile}.`,
    `Résumé actuel du portefeuille : ${stats.total} candidatures (${stats.activeCount} actives, taux de retour ${stats.responseRate}%, ${stats.offersCount} offre(s), ${stats.urgentFollowUps.length} relance(s) urgente(s)).`,
    focusedApp
      ? `Candidature actuellement sélectionnée en focus : ID=${focusedApp.id}, Entreprise="${focusedApp.company}", Poste="${focusedApp.role}", Contrat="${focusedApp.type}", Statut="${focusedApp.status}", Lieu="${focusedApp.location}", Salaire="${focusedApp.salary}", Rythme="${focusedApp.rhythm}", Contact="${focusedApp.contact_name} (${focusedApp.contact_email})", CV="${focusedApp.cv_version}", Notes="${focusedApp.notes}".`
      : `Aucune candidature spécifique sélectionnée en focus.`,
    `Tu peux contrôler toute l'application via tes outils MCP :`,
    `- Candidatures : list_applications, get_application, create_application, update_application, update_application_status, toggle_application_favorite, delete_application`,
    `- Relances & Timeline : mark_follow_up_done, add_timeline_event`,
    `- Documents CV & LM : list_documents, get_document, create_document, update_document, delete_document, generate_cover_letter_pdf`,
    `- Page de Garde & Exports PDF/CSV/JSON : get_pdf_cover_settings, update_pdf_cover_settings, export_applications_pdf_report, export_applications_data, import_applications_data`,
    `- Statistiques & Profil : get_pipeline_stats, get_or_update_ai_profile`,
    `Réponds toujours en français en utilisant le formatage Markdown (titres, tableaux, listes, gras).`
  ].join('\n');

  const conversation = [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-10).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '')
    }))
  ];

  const actionsExecuted = [];
  let mutated = false;
  let documentCreated = null;

  try {
    for (let step = 0; step < 5; step++) {
      const completion = await callOpenAICompatible(settings, conversation, true);
      const choice = completion.choices && completion.choices[0];
      const msg = choice ? choice.message : null;
      if (!msg) break;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        conversation.push(msg);
        for (const tc of msg.tool_calls) {
          const fnName = tc.function?.name;
          let fnArgs = {};
          try {
            fnArgs = JSON.parse(tc.function?.arguments || '{}');
          } catch (_e) {
            fnArgs = {};
          }
          const result = executeAgentTool(store, fnName, fnArgs);
          actionsExecuted.push(result.actionLabel);
          if (result.mutated) mutated = true;
          if (result.documentCreated) documentCreated = result.documentCreated;

          conversation.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result.data)
          });
        }
        continue;
      }

      return {
        reply: msg.content || 'Action effectuée.',
        actions: actionsExecuted,
        mutated,
        documentCreated,
        provider_mode: 'openai_compatible',
        model: settings.model
      };
    }

    return {
      reply: 'Opérations effectuées avec succès.',
      actions: actionsExecuted,
      mutated,
      documentCreated,
      provider_mode: 'openai_compatible',
      model: settings.model
    };
  } catch (err) {
    const fallback = runLocalFallbackAgent(store, lastUserMessage, focusedApp, settings);
    return {
      ...fallback,
      provider_mode: 'local_fallback_after_error',
      warning: err.message,
      model: `${settings.model} (Repli autonome local)`
    };
  }
}

async function extractJobOffer(store, rawText, autoCreate = false) {
  const settings = store.getAiSettings();
  const canUseRemoteLLM = Boolean(settings.api_key && settings.api_key.trim()) || isLocalEndpoint(settings.base_url);

  let extracted = null;

  if (canUseRemoteLLM) {
    try {
      const prompt = [
        `Extrais les informations suivantes depuis le texte de cette offre d'emploi/alternance/stage et réponds UNIQUEMENT avec un objet JSON valide sans balises markdown :`,
        `{"company": "...", "role": "...", "type": "alternance|job|stage|freelance|autre", "location": "...", "work_mode": "hybrid|onsite|remote", "salary": "...", "rhythm": "...", "job_url": "...", "contact_name": "...", "contact_email": "...", "notes": "Résumé en 2 phrases des compétences demandées"}`,
        `Texte de l'offre :\n${rawText}`
      ].join('\n\n');

      const res = await callOpenAICompatible(
        settings,
        [
          { role: 'system', content: 'Tu es un extracteur JSON strict.' },
          { role: 'user', content: prompt }
        ],
        false
      );
      const rawContent = res.choices?.[0]?.message?.content || '';
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      }
    } catch (_e) {
      extracted = null;
    }
  }

  if (!extracted || !extracted.company) {
    extracted = parseJobOfferHeuristic(rawText);
  }

  let createdApp = null;
  if (autoCreate) {
    createdApp = store.createApplication({
      ...extracted,
      status: extracted.status || 'draft'
    });
  }

  return {
    extracted,
    created: createdApp
  };
}

module.exports = {
  runAgentChat,
  extractJobOffer,
  parseJobOfferHeuristic
};
