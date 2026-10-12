const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const STATUS_LABELS = {
  draft: 'À postuler',
  applied: 'Envoyée',
  interview: 'Entretien RH',
  technical: 'Test / Entretien Tech',
  offer: 'Offre reçue',
  rejected: 'Refusée'
};

const TYPE_LABELS = {
  alternance: 'Alternance',
  job: 'Job (CDI/CDD)',
  stage: 'Stage',
  freelance: 'Freelance',
  autre: 'Autre'
};

function createDatabase(customDbPath) {
  const dataDir = path.join(__dirname, '..', 'data');
  const uploadsDir = path.join(dataDir, 'uploads');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const dbPath = customDbPath || process.env.DB_PATH || path.join(dataDir, 'alt-tracker.db');
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'cv',
      version_tag TEXT DEFAULT 'v1.0',
      target_type TEXT DEFAULT 'alternance',
      file_name TEXT DEFAULT '',
      stored_name TEXT DEFAULT '',
      mime_type TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      external_url TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'alternance',
      status TEXT NOT NULL DEFAULT 'applied',
      priority TEXT NOT NULL DEFAULT 'medium',
      location TEXT DEFAULT '',
      work_mode TEXT DEFAULT 'hybrid',
      salary TEXT DEFAULT '',
      rhythm TEXT DEFAULT '',
      job_url TEXT DEFAULT '',
      applied_date TEXT DEFAULT '',
      follow_up_date TEXT DEFAULT '',
      interview_date TEXT DEFAULT '',
      contact_name TEXT DEFAULT '',
      contact_role TEXT DEFAULT '',
      contact_email TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      cv_version TEXT DEFAULT '',
      cl_version TEXT DEFAULT '',
      document_id INTEGER NULL REFERENCES documents(id) ON DELETE SET NULL,
      notes TEXT DEFAULT '',
      favorite INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS application_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      event_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
      api_key TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
      candidate_name TEXT NOT NULL DEFAULT 'Matteo',
      candidate_profile TEXT NOT NULL DEFAULT 'Développeur Fullstack JavaScript / Node.js, orienté architecture moderne, bases de données SQL et interfaces Google Material Design 3.',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_connectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'http',
      endpoint_url TEXT NOT NULL,
      auth_token TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      tools_count INTEGER NOT NULL DEFAULT 22,
      last_status TEXT DEFAULT 'connected',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pdf_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      include_cover_page INTEGER NOT NULL DEFAULT 1,
      report_title TEXT NOT NULL DEFAULT 'DOSSIER DE SUIVI DES CANDIDATURES',
      report_subtitle TEXT NOT NULL DEFAULT 'Journal officiel des envois, relances et entretiens — Alternance & Emploi',
      candidate_name TEXT NOT NULL DEFAULT 'Matteo',
      school_or_program TEXT NOT NULL DEFAULT 'Formation Superieure / Ingenierie Logicielle & Web',
      academic_year TEXT NOT NULL DEFAULT '2026 - 2027',
      target_contract TEXT NOT NULL DEFAULT 'Alternance / Contrat d''apprentissage & CDI',
      cover_note TEXT NOT NULL DEFAULT 'Ce dossier recapitule l''ensemble des demarches de recherche d''entreprise, l''etat d''avancement du pipeline de recrutement ainsi que le suivi rigoureux des relances effectuees aupres des employeurs.',
      accent_theme TEXT NOT NULL DEFAULT 'iris',
      show_kpi_boxes INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_applications_type ON applications(type);
    CREATE INDEX IF NOT EXISTS idx_applications_followup ON applications(follow_up_date);
    CREATE INDEX IF NOT EXISTS idx_events_app_id ON application_events(application_id);
  `);

  function nowIso() {
    return new Date().toISOString();
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDays(dateStr, days) {
    const base = dateStr ? new Date(dateStr) : new Date();
    base.setDate(base.getDate() + Number(days));
    return base.toISOString().slice(0, 10);
  }

  function seedIfEmpty() {
    if (process.env.SEED_SAMPLE_DATA === 'false') return;
    const countRow = db.prepare('SELECT COUNT(*) as count FROM applications').get();
    if (countRow && countRow.count > 0) return;

    const now = nowIso();
    const today = todayStr();

    const insertDoc = db.prepare(`
      INSERT INTO documents (label, doc_type, version_tag, target_type, file_name, external_url, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const doc1 = insertDoc.run(
      'CV Alternance Fullstack Node.js / React',
      'cv',
      'v2.4',
      'alternance',
      'CV_Matteo_Alternance_Fullstack_v2.4.pdf',
      '',
      'Mis en avant des projets Node.js, SQLite et architecture web moderne.',
      now
    ).lastInsertRowid;

    const doc2 = insertDoc.run(
      'CV Développeur Logiciel Junior (CDI / Stage)',
      'cv',
      'v1.8',
      'job',
      'CV_Matteo_Software_Engineer_v1.8.pdf',
      '',
      'Version orientée génie logiciel, tests automatisés et CI/CD.',
      now
    ).lastInsertRowid;

    insertDoc.run(
      'Lettre de Motivation — Alternance Tech & Cloud',
      'cover_letter',
      'v2.0',
      'alternance',
      'LM_Alternance_Tech_2026.pdf',
      '',
      'Modèle personnalisable avec paragraphe rythme école/entreprise.',
      now
    );

    const sampleApps = [
      {
        company: 'Doctolib',
        role: 'Développeur Fullstack JS / Node.js (Alternance)',
        type: 'alternance',
        status: 'interview',
        priority: 'high',
        location: 'Paris / Levallois',
        work_mode: 'hybrid',
        salary: '1 650 € / mois',
        rhythm: '3 sem. entreprise / 1 sem. école',
        job_url: 'https://careers.doctolib.fr',
        applied_date: addDays(today, -10),
        follow_up_date: addDays(today, 3),
        interview_date: `${addDays(today, 2)}T14:30`,
        contact_name: 'Claire Moreau',
        contact_role: 'Talent Acquisition Specialist',
        contact_email: 'c.moreau@doctolib.example.com',
        contact_phone: '06 12 34 56 78',
        cv_version: 'CV Alternance Fullstack Node.js / React v2.4',
        cl_version: 'LM Alternance Tech v2.0',
        document_id: Number(doc1),
        notes: 'Excellent premier échange téléphonique de 25 min. Prochaine étape : entretien technique live coding (45 min) en Node.js & React.',
        favorite: 1
      },
      {
        company: 'Datadog',
        role: 'Software Engineer Intern / Apprenti Backend',
        type: 'alternance',
        status: 'technical',
        priority: 'high',
        location: 'Paris 9e',
        work_mode: 'hybrid',
        salary: '1 850 € / mois',
        rhythm: '2 jours école / 3 jours entreprise',
        job_url: 'https://careers.datadoghq.com',
        applied_date: addDays(today, -16),
        follow_up_date: addDays(today, -1),
        interview_date: `${addDays(today, 4)}T11:00`,
        contact_name: 'Thomas Bernard',
        contact_role: 'Engineering Recruiter',
        contact_email: 't.bernard@datadog.example.com',
        contact_phone: '',
        cv_version: 'CV Alternance Fullstack Node.js / React v2.4',
        cl_version: 'LM Alternance Tech v2.0',
        document_id: Number(doc1),
        notes: 'Test HackerRank validé avec succès ! En attente de confirmation du créneau pour le débrief technique.',
        favorite: 1
      },
      {
        company: 'Qonto',
        role: 'Junior Backend Engineer (Node.js / TypeScript)',
        type: 'job',
        status: 'applied',
        priority: 'high',
        location: 'Paris 2e',
        work_mode: 'hybrid',
        salary: '46 000 € Brut/an',
        rhythm: 'Temps plein (CDI)',
        job_url: 'https://qonto.com/careers',
        applied_date: addDays(today, -8),
        follow_up_date: today,
        interview_date: '',
        contact_name: 'Sophie Laurent',
        contact_role: 'Tech Recruiter',
        contact_email: 's.laurent@qonto.example.com',
        contact_phone: '',
        cv_version: 'CV Développeur Logiciel Junior v1.8',
        cl_version: 'Pitch personnalisé LinkedIn',
        document_id: Number(doc2),
        notes: 'Candidature envoyée sur Welcome to the Jungle + message d’approche sur LinkedIn. À relancer aujourd’hui.',
        favorite: 0
      },
      {
        company: 'Alan',
        role: 'Product Engineer (Stage fin d’études / Pré-embauche)',
        type: 'stage',
        status: 'offer',
        priority: 'high',
        location: 'Full Remote (France)',
        work_mode: 'remote',
        salary: '2 000 € / mois + titres resto',
        rhythm: '6 mois temps plein',
        job_url: 'https://alan.com/careers',
        applied_date: addDays(today, -24),
        follow_up_date: '',
        interview_date: '',
        contact_name: 'Marc Lefèvre',
        contact_role: 'Engineering Lead',
        contact_email: 'marc.l@alan.example.com',
        contact_phone: '06 98 76 54 32',
        cv_version: 'CV Développeur Logiciel Junior v1.8',
        cl_version: 'Note écrite culture Alan',
        document_id: Number(doc2),
        notes: 'Offre reçue ! Équipe très bienveillante, culture écrite asynchrone.',
        favorite: 1
      },
      {
        company: 'Mistral AI',
        role: 'Alternant Développeur Plateforme & Interfaces',
        type: 'alternance',
        status: 'draft',
        priority: 'high',
        location: 'Paris',
        work_mode: 'onsite',
        salary: '1 900 € / mois',
        rhythm: '3 sem. entreprise / 1 sem. école',
        job_url: 'https://mistral.ai/careers',
        applied_date: '',
        follow_up_date: addDays(today, 1),
        interview_date: '',
        contact_name: 'Équipe Recrutement',
        contact_role: 'Talent Team',
        contact_email: 'jobs@mistral.example.com',
        contact_phone: '',
        cv_version: 'CV Alternance Fullstack Node.js / React v2.4',
        cl_version: 'À rédiger',
        document_id: Number(doc1),
        notes: 'Adapter le CV pour mettre en avant les projets IA et les interfaces web rapides avant d’envoyer.',
        favorite: 1
      },
      {
        company: 'OVHcloud',
        role: 'Alternant Développeur Web & API Cloud',
        type: 'alternance',
        status: 'rejected',
        priority: 'medium',
        location: 'Roubaix / Télétravail',
        work_mode: 'remote',
        salary: '1 450 € / mois',
        rhythm: '1 sem. école / 3 sem. entreprise',
        job_url: 'https://corporate.ovhcloud.com/fr/careers/',
        applied_date: addDays(today, -28),
        follow_up_date: '',
        interview_date: '',
        contact_name: 'Service RH Campus',
        contact_role: 'Campus Manager',
        contact_email: 'campus@ovh.example.com',
        contact_phone: '',
        cv_version: 'CV Alternance Fullstack Node.js / React v2.4',
        cl_version: 'LM Alternance Tech v2.0',
        document_id: Number(doc1),
        notes: 'Poste déjà pourvu en interne, mais profil conservé dans leur vivier.',
        favorite: 0
      }
    ];

    for (const app of sampleApps) {
      createApplication(app);
    }
  }

  function listApplications(filters = {}) {
    const clauses = [];
    const params = [];

    if (filters.type && filters.type !== 'all') {
      clauses.push('a.type = ?');
      params.push(filters.type);
    }

    if (filters.status && filters.status !== 'all') {
      clauses.push('a.status = ?');
      params.push(filters.status);
    }

    if (filters.priority && filters.priority !== 'all') {
      clauses.push('a.priority = ?');
      params.push(filters.priority);
    }

    if (filters.work_mode && filters.work_mode !== 'all') {
      clauses.push('a.work_mode = ?');
      params.push(filters.work_mode);
    }

    if (filters.favorite === 'true' || filters.favorite === '1') {
      clauses.push('a.favorite = 1');
    }

    if (filters.due_followup === 'true' || filters.due_followup === '1') {
      const today = todayStr();
      clauses.push("a.follow_up_date != '' AND a.follow_up_date <= ? AND a.status NOT IN ('offer', 'rejected')");
      params.push(today);
    }

    if (filters.search && filters.search.trim() !== '') {
      const q = `%${filters.search.trim().toLowerCase()}%`;
      clauses.push(`(
        LOWER(a.company) LIKE ? OR
        LOWER(a.role) LIKE ? OR
        LOWER(a.location) LIKE ? OR
        LOWER(a.notes) LIKE ? OR
        LOWER(a.contact_name) LIKE ? OR
        LOWER(a.cv_version) LIKE ?
      )`);
      params.push(q, q, q, q, q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    let orderSql = 'ORDER BY a.favorite DESC, a.updated_at DESC, a.id DESC';
    switch (filters.sort) {
      case 'applied_desc':
        orderSql = "ORDER BY CASE WHEN a.applied_date = '' THEN 1 ELSE 0 END, a.applied_date DESC, a.id DESC";
        break;
      case 'followup_asc':
        orderSql = "ORDER BY CASE WHEN a.follow_up_date = '' THEN 1 ELSE 0 END, a.follow_up_date ASC, a.id DESC";
        break;
      case 'company_asc':
        orderSql = 'ORDER BY LOWER(a.company) ASC, a.id DESC';
        break;
      case 'priority_desc':
        orderSql = "ORDER BY CASE a.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC, a.updated_at DESC";
        break;
      default:
        break;
    }

    const sql = `
      SELECT a.*, d.label AS document_label, d.file_name AS document_file_name
      FROM applications a
      LEFT JOIN documents d ON a.document_id = d.id
      ${whereSql}
      ${orderSql}
    `;

    return db.prepare(sql).all(...params);
  }

  function getApplicationById(id) {
    const app = db.prepare(`
      SELECT a.*, d.label AS document_label, d.file_name AS document_file_name
      FROM applications a
      LEFT JOIN documents d ON a.document_id = d.id
      WHERE a.id = ?
    `).get(Number(id));

    if (!app) return null;

    const events = db.prepare(`
      SELECT * FROM application_events
      WHERE application_id = ?
      ORDER BY event_date DESC, id DESC
    `).all(Number(id));

    return {
      ...app,
      events
    };
  }

  function createApplication(data) {
    const now = nowIso();
    const status = data.status || 'applied';
    const type = data.type || 'alternance';
    const appliedDate = data.applied_date !== undefined
      ? data.applied_date
      : (status === 'draft' ? '' : todayStr());

    const stmt = db.prepare(`
      INSERT INTO applications (
        company, role, type, status, priority, location, work_mode,
        salary, rhythm, job_url, applied_date, follow_up_date, interview_date,
        contact_name, contact_role, contact_email, contact_phone,
        cv_version, cl_version, document_id, notes, favorite, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      (data.company || '').trim(),
      (data.role || '').trim(),
      type,
      status,
      data.priority || 'medium',
      data.location || '',
      data.work_mode || 'hybrid',
      data.salary || '',
      data.rhythm || '',
      data.job_url || '',
      appliedDate,
      data.follow_up_date || '',
      data.interview_date || '',
      data.contact_name || '',
      data.contact_role || '',
      data.contact_email || '',
      data.contact_phone || '',
      data.cv_version || '',
      data.cl_version || '',
      data.document_id ? Number(data.document_id) : null,
      data.notes || '',
      data.favorite ? 1 : 0,
      now,
      now
    );

    const newId = Number(result.lastInsertRowid);

    const eventTitle = status === 'draft'
      ? 'Brouillon de candidature créé'
      : `Candidature enregistrée (${STATUS_LABELS[status] || status})`;

    db.prepare(`
      INSERT INTO application_events (application_id, event_type, title, description, event_date)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      newId,
      'created',
      eventTitle,
      `${TYPE_LABELS[type] || type} chez ${(data.company || '').trim()} — ${(data.role || '').trim()}`,
      appliedDate ? `${appliedDate}T09:00:00.000Z` : now
    );

    return getApplicationById(newId);
  }

  function updateApplication(id, data) {
    const existing = getApplicationById(id);
    if (!existing) return null;

    const now = nowIso();
    const updated = {
      company: data.company !== undefined ? data.company.trim() : existing.company,
      role: data.role !== undefined ? data.role.trim() : existing.role,
      type: data.type !== undefined ? data.type : existing.type,
      status: data.status !== undefined ? data.status : existing.status,
      priority: data.priority !== undefined ? data.priority : existing.priority,
      location: data.location !== undefined ? data.location : existing.location,
      work_mode: data.work_mode !== undefined ? data.work_mode : existing.work_mode,
      salary: data.salary !== undefined ? data.salary : existing.salary,
      rhythm: data.rhythm !== undefined ? data.rhythm : existing.rhythm,
      job_url: data.job_url !== undefined ? data.job_url : existing.job_url,
      applied_date: data.applied_date !== undefined ? data.applied_date : existing.applied_date,
      follow_up_date: data.follow_up_date !== undefined ? data.follow_up_date : existing.follow_up_date,
      interview_date: data.interview_date !== undefined ? data.interview_date : existing.interview_date,
      contact_name: data.contact_name !== undefined ? data.contact_name : existing.contact_name,
      contact_role: data.contact_role !== undefined ? data.contact_role : existing.contact_role,
      contact_email: data.contact_email !== undefined ? data.contact_email : existing.contact_email,
      contact_phone: data.contact_phone !== undefined ? data.contact_phone : existing.contact_phone,
      cv_version: data.cv_version !== undefined ? data.cv_version : existing.cv_version,
      cl_version: data.cl_version !== undefined ? data.cl_version : existing.cl_version,
      document_id: data.document_id !== undefined ? (data.document_id ? Number(data.document_id) : null) : existing.document_id,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      favorite: data.favorite !== undefined ? (data.favorite ? 1 : 0) : existing.favorite
    };

    db.prepare(`
      UPDATE applications SET
        company = ?, role = ?, type = ?, status = ?, priority = ?,
        location = ?, work_mode = ?, salary = ?, rhythm = ?, job_url = ?,
        applied_date = ?, follow_up_date = ?, interview_date = ?,
        contact_name = ?, contact_role = ?, contact_email = ?, contact_phone = ?,
        cv_version = ?, cl_version = ?, document_id = ?, notes = ?, favorite = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updated.company, updated.role, updated.type, updated.status, updated.priority,
      updated.location, updated.work_mode, updated.salary, updated.rhythm, updated.job_url,
      updated.applied_date, updated.follow_up_date, updated.interview_date,
      updated.contact_name, updated.contact_role, updated.contact_email, updated.contact_phone,
      updated.cv_version, updated.cl_version, updated.document_id, updated.notes, updated.favorite,
      now, Number(id)
    );

    if (existing.status !== updated.status) {
      const oldLabel = STATUS_LABELS[existing.status] || existing.status;
      const newLabel = STATUS_LABELS[updated.status] || updated.status;
      db.prepare(`
        INSERT INTO application_events (application_id, event_type, title, description, event_date)
        VALUES (?, 'status_change', ?, ?, ?)
      `).run(
        Number(id),
        `Statut : ${oldLabel} → ${newLabel}`,
        data.status_note || `Passage à l'étape "${newLabel}".`,
        now
      );
    }

    return getApplicationById(id);
  }

  function markFollowUpDone(id, options = {}) {
    const existing = getApplicationById(id);
    if (!existing) return null;

    const now = nowIso();
    const nextDays = options.nextFollowUpDays !== undefined ? Number(options.nextFollowUpDays) : 7;
    const nextDate = nextDays > 0 ? addDays(todayStr(), nextDays) : '';
    const note = options.note || 'Relance envoyée au recruteur.';

    db.prepare(`
      UPDATE applications
      SET follow_up_date = ?, updated_at = ?
      WHERE id = ?
    `).run(nextDate, now, Number(id));

    db.prepare(`
      INSERT INTO application_events (application_id, event_type, title, description, event_date)
      VALUES (?, 'follow_up', ?, ?, ?)
    `).run(
      Number(id),
      'Relance effectuée',
      nextDate ? `${note} (Prochaine relance programmée le ${nextDate})` : note,
      now
    );

    return getApplicationById(id);
  }

  function addApplicationEvent(applicationId, eventData) {
    const existing = getApplicationById(applicationId);
    if (!existing) return null;

    const now = nowIso();
    db.prepare(`
      INSERT INTO application_events (application_id, event_type, title, description, event_date)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      Number(applicationId),
      eventData.event_type || 'note',
      (eventData.title || 'Note de suivi').trim(),
      eventData.description || '',
      eventData.event_date || now
    );

    db.prepare('UPDATE applications SET updated_at = ? WHERE id = ?').run(now, Number(applicationId));
    return getApplicationById(applicationId);
  }

  function deleteApplication(id) {
    const res = db.prepare('DELETE FROM applications WHERE id = ?').run(Number(id));
    return res.changes > 0;
  }

  function buildSamplePdfBuffer(title, version, notes, fullBodyText = '') {
    const cleanAscii = (str) =>
      String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’]/g, "'")
        .replace(/[()\\]/g, '')
        .replace(/[^\x20-\x7E]/g, ' ');

    const wrapLines = (text, maxLen = 82) => {
      const paragraphs = String(text || '').split(/\r?\n/);
      const out = [];
      for (const p of paragraphs) {
        const cleanP = cleanAscii(p).trim();
        if (!cleanP) {
          out.push('');
          continue;
        }
        const words = cleanP.split(/\s+/);
        let current = '';
        for (const w of words) {
          if ((current + ' ' + w).trim().length > maxLen) {
            if (current) out.push(current);
            current = w;
          } else {
            current = current ? `${current} ${w}` : w;
          }
        }
        if (current) out.push(current);
      }
      return out;
    };

    const t = cleanAscii(title || 'Document Candidature');
    const v = cleanAscii(version || 'v1.0');
    const n = cleanAscii(notes || '');

    const lines = [
      'BT',
      '/F1 18 Tf',
      '50 775 Td',
      `(${t}) Tj`,
      '/F1 11 Tf',
      '0 -22 Td',
      `(Version : ${v}  |  Alt-Tracker Document) Tj`,
      '0 -20 Td',
      '(--------------------------------------------------------------------------------) Tj'
    ];

    if (fullBodyText && fullBodyText.trim()) {
      lines.push('/F1 10.5 Tf');
      lines.push('0 -10 Td');
      const wrapped = wrapLines(fullBodyText, 84).slice(0, 38);
      for (const wl of wrapped) {
        lines.push('0 -16 Td');
        lines.push(`(${wl}) Tj`);
      }
    } else {
      lines.push('0 -24 Td');
      lines.push('/F1 11 Tf');
      for (const nl of wrapLines(n, 80).slice(0, 4)) {
        lines.push(`(${nl}) Tj`);
        lines.push('0 -16 Td');
      }
      lines.push('0 -16 Td');
      lines.push('/F1 13 Tf');
      lines.push('(Competences & Points Cles mis en avant) Tj');
      lines.push('0 -22 Td');
      lines.push('/F1 11 Tf');
      lines.push('(- Developpement Fullstack JavaScript : Node.js, Express, SQLite, API REST) Tj');
      lines.push('0 -18 Td');
      lines.push('(- Architecture Frontend : Google Material Design 3.0 (Material You), UI/UX) Tj');
      lines.push('0 -18 Td');
      lines.push('(- Qualite logicielle : Tests automatises, Git, Integration Continue) Tj');
      lines.push('0 -36 Td');
      lines.push('/F1 10 Tf');
      lines.push('(Astuce : Cliquez sur "Modifier" sur la carte du document pour televerser votre propre PDF.) Tj');
    }

    lines.push('ET');
    const streamContent = lines.join('\n');

    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      `5 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'utf8')} >>\nstream\n${streamContent}\nendstream\nendobj\n`
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const obj of objects) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += obj;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < offsets.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, 'utf8');
  }

  function ensureDocumentFiles() {
    if (process.env.SEED_SAMPLE_DATA === 'false') return;
    const docs = db.prepare('SELECT * FROM documents').all();
    for (const doc of docs) {
      const existingPath = doc.stored_name ? path.join(uploadsDir, doc.stored_name) : '';
      const fileMissing = !doc.stored_name || !fs.existsSync(existingPath);
      if (fileMissing && doc.file_name && doc.file_name.toLowerCase().endsWith('.pdf')) {
        const safeBase = path.basename(doc.file_name).replace(/[^a-zA-Z0-9._-]/g, '_');
        const storedName = `sample_${doc.id}_${safeBase}`;
        const fullPath = path.join(uploadsDir, storedName);
        const buf = buildSamplePdfBuffer(doc.label, doc.version_tag, doc.notes);
        fs.writeFileSync(fullPath, buf);
        db.prepare(`
          UPDATE documents
          SET stored_name = ?, mime_type = 'application/pdf', file_size = ?
          WHERE id = ?
        `).run(storedName, buf.length, doc.id);
      }
    }
  }

  function listDocuments() {
    const docs = db.prepare(`
      SELECT
        d.*,
        COUNT(a.id) AS usage_count,
        SUM(CASE WHEN a.status IN ('interview', 'technical', 'offer') THEN 1 ELSE 0 END) AS positive_count
      FROM documents d
      LEFT JOIN applications a ON a.document_id = d.id OR (a.cv_version != '' AND a.cv_version LIKE '%' || d.label || '%')
      GROUP BY d.id
      ORDER BY d.created_at DESC, d.id DESC
    `).all();
    return docs;
  }

  function getDocumentById(id) {
    return db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(id)) || null;
  }

  function createDocument(docData) {
    const now = nowIso();
    let storedName = '';
    let fileName = docData.file_name || '';
    let fileSize = 0;

    if (docData.file_base64 && docData.file_name) {
      const safeBase = path.basename(docData.file_name).replace(/[^a-zA-Z0-9._-]/g, '_');
      storedName = `${Date.now()}_${safeBase}`;
      const filePath = path.join(uploadsDir, storedName);
      const base64Clean = docData.file_base64.includes(',')
        ? docData.file_base64.split(',')[1]
        : docData.file_base64;
      const buffer = Buffer.from(base64Clean, 'base64');
      fs.writeFileSync(filePath, buffer);
      fileSize = buffer.length;
    } else if (docData.generate_pdf_text) {
      const safeLabel = (docData.label || 'document').replace(/[^a-zA-Z0-9_-]/g, '_');
      fileName = fileName || `${safeLabel}.pdf`;
      storedName = `${Date.now()}_${fileName}`;
      const filePath = path.join(uploadsDir, storedName);
      const buffer = buildSamplePdfBuffer(
        docData.label,
        docData.version_tag || 'IA',
        docData.notes || '',
        docData.generate_pdf_text
      );
      fs.writeFileSync(filePath, buffer);
      fileSize = buffer.length;
    }

    const res = db.prepare(`
      INSERT INTO documents (
        label, doc_type, version_tag, target_type,
        file_name, stored_name, mime_type, file_size, external_url, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      (docData.label || 'Document sans titre').trim(),
      docData.doc_type || 'cv',
      docData.version_tag || 'v1.0',
      docData.target_type || 'alternance',
      fileName,
      storedName,
      docData.mime_type || 'application/pdf',
      fileSize,
      docData.external_url || '',
      docData.notes || '',
      now
    );

    return getDocumentById(Number(res.lastInsertRowid));
  }

  function updateDocument(id, docData) {
    const existing = getDocumentById(id);
    if (!existing) return null;

    let storedName = existing.stored_name;
    let fileName = existing.file_name;
    let mimeType = existing.mime_type;
    let fileSize = existing.file_size;

    if (docData.file_base64 && docData.file_name) {
      if (existing.stored_name) {
        const oldPath = path.join(uploadsDir, existing.stored_name);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      const safeBase = path.basename(docData.file_name).replace(/[^a-zA-Z0-9._-]/g, '_');
      storedName = `${Date.now()}_${safeBase}`;
      const filePath = path.join(uploadsDir, storedName);
      const base64Clean = docData.file_base64.includes(',')
        ? docData.file_base64.split(',')[1]
        : docData.file_base64;
      const buffer = Buffer.from(base64Clean, 'base64');
      fs.writeFileSync(filePath, buffer);
      fileName = docData.file_name;
      mimeType = docData.mime_type || 'application/pdf';
      fileSize = buffer.length;
    }

    db.prepare(`
      UPDATE documents SET
        label = ?, doc_type = ?, version_tag = ?,
        file_name = ?, stored_name = ?, mime_type = ?, file_size = ?,
        external_url = ?, notes = ?
      WHERE id = ?
    `).run(
      docData.label !== undefined ? docData.label.trim() : existing.label,
      docData.doc_type !== undefined ? docData.doc_type : existing.doc_type,
      docData.version_tag !== undefined ? docData.version_tag : existing.version_tag,
      fileName,
      storedName,
      mimeType,
      fileSize,
      docData.external_url !== undefined ? docData.external_url : existing.external_url,
      docData.notes !== undefined ? docData.notes : existing.notes,
      Number(id)
    );

    return getDocumentById(Number(id));
  }

  function deleteDocument(id) {
    const doc = getDocumentById(id);
    if (!doc) return false;
    if (doc.stored_name) {
      const filePath = path.join(uploadsDir, doc.stored_name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    const res = db.prepare('DELETE FROM documents WHERE id = ?').run(Number(id));
    return res.changes > 0;
  }

  function getAiSettings() {
    let row = db.prepare('SELECT * FROM ai_settings WHERE id = 1').get();
    if (!row) {
      const now = nowIso();
      db.prepare(`
        INSERT INTO ai_settings (id, base_url, api_key, model, candidate_name, candidate_profile, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?)
      `).run(
        process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        process.env.OPENAI_API_KEY || '',
        process.env.OPENAI_MODEL || 'gpt-4o-mini',
        'Matteo',
        'Développeur Fullstack JavaScript / Node.js, orienté architecture web moderne, SQLite/SQL et interfaces Google Material Design 3.',
        now
      );
      row = db.prepare('SELECT * FROM ai_settings WHERE id = 1').get();
    }
    return {
      base_url: row.base_url || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      api_key: row.api_key || process.env.OPENAI_API_KEY || '',
      model: row.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      candidate_name: row.candidate_name || 'Matteo',
      candidate_profile: row.candidate_profile || '',
      has_api_key: Boolean((row.api_key && row.api_key.trim()) || process.env.OPENAI_API_KEY),
      updated_at: row.updated_at
    };
  }

  function saveAiSettings(data = {}) {
    const current = getAiSettings();
    const now = nowIso();
    const nextBaseUrl = data.base_url !== undefined ? data.base_url.trim().replace(/\/+$/, '') : current.base_url;
    const nextApiKey = data.api_key !== undefined && data.api_key !== '••••••••' ? data.api_key.trim() : current.api_key;
    const nextModel = data.model !== undefined ? data.model.trim() : current.model;
    const nextName = data.candidate_name !== undefined ? data.candidate_name.trim() : current.candidate_name;
    const nextProfile = data.candidate_profile !== undefined ? data.candidate_profile.trim() : current.candidate_profile;

    db.prepare(`
      UPDATE ai_settings SET
        base_url = ?, api_key = ?, model = ?, candidate_name = ?, candidate_profile = ?, updated_at = ?
      WHERE id = 1
    `).run(nextBaseUrl, nextApiKey, nextModel, nextName, nextProfile, now);

    return getAiSettings();
  }

  function getStats() {
    const allApps = db.prepare('SELECT * FROM applications ORDER BY updated_at DESC').all();
    const today = todayStr();
    const soonDate = addDays(today, 3);

    const byStatus = {
      draft: 0,
      applied: 0,
      interview: 0,
      technical: 0,
      offer: 0,
      rejected: 0
    };

    const byType = {
      alternance: 0,
      job: 0,
      stage: 0,
      freelance: 0,
      autre: 0
    };

    const byWorkMode = {
      onsite: 0,
      hybrid: 0,
      remote: 0
    };

    const cvMap = new Map();
    const urgentFollowUps = [];
    const upcomingInterviews = [];

    let sentCount = 0;
    let answeredCount = 0;
    let positiveCount = 0;

    for (const app of allApps) {
      if (byStatus[app.status] !== undefined) byStatus[app.status]++;
      if (byType[app.type] !== undefined) byType[app.type]++;
      else byType.autre++;

      if (byWorkMode[app.work_mode] !== undefined) byWorkMode[app.work_mode]++;

      if (app.status !== 'draft') {
        sentCount++;
        if (['interview', 'technical', 'offer', 'rejected'].includes(app.status)) {
          answeredCount++;
        }
        if (['interview', 'technical', 'offer'].includes(app.status)) {
          positiveCount++;
        }
      }

      if (
        app.follow_up_date &&
        app.follow_up_date <= soonDate &&
        !['offer', 'rejected'].includes(app.status)
      ) {
        urgentFollowUps.push({
          ...app,
          is_overdue: app.follow_up_date < today,
          is_today: app.follow_up_date === today
        });
      }

      if (app.interview_date && app.interview_date.slice(0, 10) >= today) {
        upcomingInterviews.push(app);
      }

      if (app.cv_version && app.cv_version.trim() !== '') {
        const key = app.cv_version.trim();
        const entry = cvMap.get(key) || { cv_version: key, total: 0, positive: 0, offers: 0 };
        entry.total++;
        if (['interview', 'technical', 'offer'].includes(app.status)) entry.positive++;
        if (app.status === 'offer') entry.offers++;
        cvMap.set(key, entry);
      }
    }

    urgentFollowUps.sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date));
    upcomingInterviews.sort((a, b) => a.interview_date.localeCompare(b.interview_date));

    const recentEvents = db.prepare(`
      SELECT e.*, a.company, a.role, a.type
      FROM application_events e
      JOIN applications a ON e.application_id = a.id
      ORDER BY e.event_date DESC, e.id DESC
      LIMIT 10
    `).all();

    const responseRate = sentCount > 0 ? Math.round((answeredCount / sentCount) * 100) : 0;
    const interviewRate = sentCount > 0 ? Math.round((positiveCount / sentCount) * 100) : 0;
    const activeCount = byStatus.applied + byStatus.interview + byStatus.technical;

    return {
      total: allApps.length,
      sentCount,
      activeCount,
      positiveCount,
      offersCount: byStatus.offer,
      responseRate,
      interviewRate,
      byStatus,
      byType,
      byWorkMode,
      urgentFollowUps,
      upcomingInterviews,
      recentEvents,
      cvPerformance: Array.from(cvMap.values()).sort((a, b) => b.total - a.total)
    };
  }

  function exportCsv() {
    const apps = listApplications({});
    const headers = [
      'id', 'company', 'role', 'type', 'status', 'priority',
      'location', 'work_mode', 'salary', 'rhythm', 'job_url',
      'applied_date', 'follow_up_date', 'interview_date',
      'contact_name', 'contact_role', 'contact_email', 'contact_phone',
      'cv_version', 'cl_version', 'notes', 'favorite'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes(';')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines = [headers.join(',')];
    for (const app of apps) {
      lines.push(headers.map((h) => escapeCsv(app[h])).join(','));
    }
    return lines.join('\n');
  }

  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function importApplications(payload) {
    let items = [];
    if (Array.isArray(payload)) {
      items = payload;
    } else if (payload && Array.isArray(payload.applications)) {
      items = payload.applications;
    } else if (payload && typeof payload.csv === 'string') {
      const lines = payload.csv.split(/\r?\n/).filter((l) => l.trim() !== '');
      if (lines.length >= 2) {
        const headers = parseCsvLine(lines[0]).map((h) => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const values = parseCsvLine(lines[i]);
          const obj = {};
          headers.forEach((h, idx) => {
            obj[h] = values[idx] !== undefined ? values[idx] : '';
          });
          if (obj.company && obj.role) {
            items.push(obj);
          }
        }
      }
    }

    const imported = [];
    for (const item of items) {
      if (!item.company || !item.role) continue;
      imported.push(createApplication({
        company: item.company,
        role: item.role,
        type: item.type || 'alternance',
        status: item.status || 'applied',
        priority: item.priority || 'medium',
        location: item.location || '',
        work_mode: item.work_mode || 'hybrid',
        salary: item.salary || '',
        rhythm: item.rhythm || '',
        job_url: item.job_url || '',
        applied_date: item.applied_date || '',
        follow_up_date: item.follow_up_date || '',
        interview_date: item.interview_date || '',
        contact_name: item.contact_name || '',
        contact_role: item.contact_role || '',
        contact_email: item.contact_email || '',
        contact_phone: item.contact_phone || '',
        cv_version: item.cv_version || '',
        cl_version: item.cl_version || '',
        notes: item.notes || '',
        favorite: Number(item.favorite) === 1
      }));
    }
    return imported;
  }

  // --- PDF Cover Page Settings ---
  function getPdfSettings() {
    let row = db.prepare('SELECT * FROM pdf_settings WHERE id = 1').get();
    if (!row) {
      const now = nowIso();
      const aiRow = db.prepare('SELECT candidate_name FROM ai_settings WHERE id = 1').get();
      const defaultName = (aiRow && aiRow.candidate_name) || 'Matteo';
      db.prepare(`
        INSERT INTO pdf_settings (
          id, include_cover_page, report_title, report_subtitle,
          candidate_name, school_or_program, academic_year,
          target_contract, cover_note, accent_theme, show_kpi_boxes, updated_at
        ) VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?, 'iris', 1, ?)
      `).run(
        'DOSSIER DE SUIVI DES CANDIDATURES',
        'Journal officiel des envois, relances et entretiens — Alternance & Emploi',
        defaultName,
        'Formation Superieure / Ingenierie Logicielle & Web',
        '2026 - 2027',
        "Alternance / Contrat d'apprentissage & CDI",
        "Ce dossier recapitule l'ensemble des demarches de recherche d'entreprise, l'etat d'avancement du pipeline de recrutement ainsi que le suivi rigoureux des relances effectuees aupres des employeurs.",
        now
      );
      row = db.prepare('SELECT * FROM pdf_settings WHERE id = 1').get();
    }
    return {
      ...row,
      include_cover_page: Boolean(row.include_cover_page),
      show_kpi_boxes: Boolean(row.show_kpi_boxes)
    };
  }

  function savePdfSettings(data = {}) {
    const current = getPdfSettings();
    const now = nowIso();
    const nextInclude =
      data.include_cover_page !== undefined ? (data.include_cover_page ? 1 : 0) : (current.include_cover_page ? 1 : 0);
    const nextKpi =
      data.show_kpi_boxes !== undefined ? (data.show_kpi_boxes ? 1 : 0) : (current.show_kpi_boxes ? 1 : 0);

    db.prepare(`
      UPDATE pdf_settings SET
        include_cover_page = ?,
        report_title = ?,
        report_subtitle = ?,
        candidate_name = ?,
        school_or_program = ?,
        academic_year = ?,
        target_contract = ?,
        cover_note = ?,
        accent_theme = ?,
        show_kpi_boxes = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      nextInclude,
      data.report_title !== undefined ? String(data.report_title).trim() : current.report_title,
      data.report_subtitle !== undefined ? String(data.report_subtitle).trim() : current.report_subtitle,
      data.candidate_name !== undefined ? String(data.candidate_name).trim() : current.candidate_name,
      data.school_or_program !== undefined ? String(data.school_or_program).trim() : current.school_or_program,
      data.academic_year !== undefined ? String(data.academic_year).trim() : current.academic_year,
      data.target_contract !== undefined ? String(data.target_contract).trim() : current.target_contract,
      data.cover_note !== undefined ? String(data.cover_note).trim() : current.cover_note,
      data.accent_theme !== undefined ? String(data.accent_theme).trim() : current.accent_theme,
      nextKpi,
      now
    );

    return getPdfSettings();
  }

  function exportApplicationsPdfBuffer(filters = {}, coverOverrides = {}) {
    const apps = listApplications(filters);
    const stats = getStats();
    const savedCover = getPdfSettings();

    const mergedCover = {
      ...savedCover,
      ...coverOverrides
    };
    if (filters.cover !== undefined) {
      mergedCover.include_cover_page =
        filters.cover !== '0' && filters.cover !== 'false' && filters.cover !== false;
    }
    if (filters.report_title) mergedCover.report_title = filters.report_title;
    if (filters.report_subtitle) mergedCover.report_subtitle = filters.report_subtitle;
    if (filters.candidate_name) mergedCover.candidate_name = filters.candidate_name;
    if (filters.school_or_program) mergedCover.school_or_program = filters.school_or_program;
    if (filters.academic_year) mergedCover.academic_year = filters.academic_year;
    if (filters.target_contract) mergedCover.target_contract = filters.target_contract;
    if (filters.cover_note) mergedCover.cover_note = filters.cover_note;
    if (filters.accent_theme) mergedCover.accent_theme = filters.accent_theme;
    if (filters.show_kpi_boxes !== undefined) {
      mergedCover.show_kpi_boxes =
        filters.show_kpi_boxes !== '0' && filters.show_kpi_boxes !== 'false' && filters.show_kpi_boxes !== false;
    }

    const THEME_PALETTES = {
      iris: {
        primary: '0.247 0.216 0.545',
        accent: '0.380 0.325 0.690',
        container: '0.918 0.902 0.980',
        softBg: '0.968 0.962 0.994',
        darkText: '0.15 0.14 0.28'
      },
      emerald: {
        primary: '0.047 0.420 0.345',
        accent: '0.086 0.545 0.447',
        container: '0.835 0.957 0.922',
        softBg: '0.949 0.988 0.976',
        darkText: '0.05 0.22 0.18'
      },
      ocean: {
        primary: '0.043 0.341 0.816',
        accent: '0.157 0.467 0.918',
        container: '0.859 0.918 0.996',
        softBg: '0.953 0.976 0.998',
        darkText: '0.05 0.18 0.38'
      },
      terracotta: {
        primary: '0.588 0.239 0.098',
        accent: '0.737 0.329 0.165',
        container: '0.992 0.898 0.855',
        softBg: '0.996 0.965 0.949',
        darkText: '0.28 0.11 0.05'
      },
      cherry: {
        primary: '0.616 0.110 0.302',
        accent: '0.776 0.180 0.408',
        container: '0.992 0.886 0.922',
        softBg: '0.996 0.961 0.973',
        darkText: '0.28 0.06 0.14'
      }
    };

    const palette = THEME_PALETTES[mergedCover.accent_theme] || THEME_PALETTES.iris;

    const cleanPdfText = (str, maxLen = 40) => {
      const ascii = String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’]/g, "'")
        .replace(/[—–]/g, '-')
        .replace(/[()\\]/g, '')
        .replace(/[^\x20-\x7E]/g, ' ')
        .trim();
      if (ascii.length <= maxLen) return ascii;
      return ascii.slice(0, Math.max(1, maxLen - 2)) + '..';
    };

    const wrapPdfLines = (str, maxChars = 95, maxLines = 3) => {
      const words = cleanPdfText(str, maxChars * maxLines).split(/\s+/).filter(Boolean);
      const lines = [];
      let current = '';
      for (const w of words) {
        if ((current + ' ' + w).trim().length > maxChars) {
          if (current) lines.push(current);
          current = w;
          if (lines.length >= maxLines) break;
        } else {
          current = (current + ' ' + w).trim();
        }
      }
      if (current && lines.length < maxLines) lines.push(current);
      return lines;
    };

    const workModeMap = {
      hybrid: 'Hybride',
      onsite: 'Presentiel',
      remote: 'Remote'
    };

    // Landscape A4: 842 x 595 pt
    const rowsPerPage = 16;
    const chunks = [];
    if (apps.length === 0) {
      chunks.push([]);
    } else {
      for (let i = 0; i < apps.length; i += rowsPerPage) {
        chunks.push(apps.slice(i, i + rowsPerPage));
      }
    }

    const hasCoverPage = Boolean(mergedCover.include_cover_page);
    const totalPages = chunks.length + (hasCoverPage ? 1 : 0);
    const genDate = todayStr();
    const pageContents = [];

    // --- Page 1: Material Design 3.0 Executive Cover Page (Page de Garde) ---
    if (hasCoverPage) {
      const coverCmds = [];

      // Soft Page Background Frame
      coverCmds.push(`${palette.softBg} rg`);
      coverCmds.push('24 24 794 547 re f');

      // Left Vertical Architectural Accent Ribbon
      coverCmds.push(`${palette.primary} rg`);
      coverCmds.push('24 24 16 547 re f');

      // Hero Banner Card (Top)
      coverCmds.push(`${palette.primary} rg`);
      coverCmds.push('56 388 738 158 re f');

      // Decorative Geometric Blocks inside Hero Banner
      coverCmds.push(`${palette.accent} rg`);
      coverCmds.push('640 388 154 158 re f');
      coverCmds.push(`${palette.container} rg`);
      coverCmds.push('740 492 54 54 re f');

      // Hero Top Pill Badge
      const yearStr = cleanPdfText(mergedCover.academic_year || '2026 - 2027', 24);
      coverCmds.push('1 1 1 rg');
      coverCmds.push(
        `BT /F2 10 Tf 78 516 Td (ALT-TRACKER  |  PAGE DE GARDE OFFICIELLE  |  PROMOTION ${yearStr}) Tj ET`
      );

      // Hero Main Report Title & Subtitle
      const titleText = cleanPdfText(mergedCover.report_title || 'DOSSIER DE SUIVI DES CANDIDATURES', 58);
      const subText = cleanPdfText(
        mergedCover.report_subtitle || 'Journal officiel des envois, relances et entretiens',
        86
      );
      coverCmds.push(`BT /F2 22 Tf 78 474 Td (${titleText}) Tj ET`);
      coverCmds.push(`BT /F1 11.5 Tf 78 446 Td (${subText}) Tj ET`);

      // Hero Bottom Meta Strip
      const filterDesc =
        filters.type && filters.type !== 'all'
          ? `Filtre Contrat : ${cleanPdfText(TYPE_LABELS[filters.type] || filters.type, 20)}`
          : 'Perimetre : Toutes les candidatures';
      coverCmds.push(
        `BT /F2 9.5 Tf 78 410 Td (Date d'edition : ${genDate}   |   ${filterDesc}   |   ${apps.length} candidature(s) recensee(s)) Tj ET`
      );

      // --- Candidate & Academic Profile Card (Middle) ---
      coverCmds.push('1 1 1 rg');
      coverCmds.push('56 266 738 104 re f');
      coverCmds.push(`${palette.container} RG 1.2 w`);
      coverCmds.push('56 266 738 104 re S');

      // Left Accent Bar on Profile Card
      coverCmds.push(`${palette.accent} rg`);
      coverCmds.push('56 266 6 104 re f');

      const candName = cleanPdfText(mergedCover.candidate_name || 'Matteo', 38);
      const schoolName = cleanPdfText(mergedCover.school_or_program || 'Formation Superieure', 44);
      const contractTarget = cleanPdfText(mergedCover.target_contract || 'Alternance & Emploi', 44);

      coverCmds.push(`${palette.darkText} rg`);
      coverCmds.push('BT /F2 9 Tf 78 346 Td (CANDIDAT) Tj ET');
      coverCmds.push(`BT /F2 13 Tf 78 329 Td (${candName}) Tj ET`);

      coverCmds.push('BT /F2 9 Tf 78 302 Td (ECOLE / FORMATION / PROGRAMME) Tj ET');
      coverCmds.push(`BT /F1 11 Tf 78 286 Td (${schoolName}) Tj ET`);

      coverCmds.push('BT /F2 9 Tf 450 346 Td (CONTRAT & OBJECTIF RECHERCHE) Tj ET');
      coverCmds.push(`BT /F2 11.5 Tf 450 329 Td (${contractTarget}) Tj ET`);

      coverCmds.push('BT /F2 9 Tf 450 302 Td (SYNTHESE DU PIPELINE) Tj ET');
      coverCmds.push(
        `BT /F1 10.5 Tf 450 286 Td (Alternances : ${stats.byType?.alternance || 0}  |  Jobs : ${stats.byType?.job || 0}  |  Stages : ${stats.byType?.stage || 0}  |  Autres : ${(stats.byType?.freelance || 0) + (stats.byType?.autre || 0)}) Tj ET`
      );

      // --- 4 KPI Summary Cards on Cover Page ---
      if (mergedCover.show_kpi_boxes) {
        const interviewTotal = (stats.byStatus?.interview || 0) + (stats.byStatus?.technical || 0);
        const kpiCards = [
          {
            label: 'CANDIDATURES LISTEES',
            value: String(apps.length),
            sub: `Dont ${stats.sentCount} envoyee(s)`
          },
          {
            label: 'ENTRETIENS & TESTS',
            value: String(interviewTotal),
            sub: `Taux d'entretien : ${stats.interviewRate}%`
          },
          {
            label: 'TAUX DE RETOUR GLOBAL',
            value: `${stats.responseRate}%`,
            sub: `Offre(s) recue(s) : ${stats.byStatus?.offer || 0}`
          },
          {
            label: 'RELANCES PLANIFIEES',
            value: String(stats.dueFollowUpsCount || 0),
            sub: 'Suivi proactif recruteurs'
          }
        ];

        kpiCards.forEach((kpi, idx) => {
          const kx = 56 + idx * 188;
          const ky = 172;
          const kw = 176;
          const kh = 78;

          coverCmds.push('1 1 1 rg');
          coverCmds.push(`${kx} ${ky} ${kw} ${kh} re f`);
          coverCmds.push(`${palette.container} rg`);
          coverCmds.push(`${kx} ${ky + kh - 6} ${kw} 6 re f`);

          coverCmds.push(`${palette.darkText} rg`);
          coverCmds.push(`BT /F2 8 Tf ${kx + 14} ${ky + 54} Td (${kpi.label}) Tj ET`);
          coverCmds.push(`${palette.primary} rg`);
          coverCmds.push(`BT /F2 20 Tf ${kx + 14} ${ky + 28} Td (${cleanPdfText(kpi.value, 12)}) Tj ET`);
          coverCmds.push('0.38 0.38 0.45 rg');
          coverCmds.push(`BT /F1 8.5 Tf ${kx + 14} ${ky + 12} Td (${cleanPdfText(kpi.sub, 26)}) Tj ET`);
        });
      }

      // --- Cover Note / Presentation Box (Bottom) ---
      coverCmds.push(`${palette.container} rg`);
      coverCmds.push('56 64 738 90 re f');
      coverCmds.push(`${palette.primary} rg`);
      coverCmds.push('56 64 5 90 re f');

      coverCmds.push(`${palette.darkText} rg`);
      coverCmds.push('BT /F2 9.5 Tf 74 134 Td (NOTE DE SYNTHESE & PRESENTATION DU DOSSIER) Tj ET');

      const noteLines = wrapPdfLines(
        mergedCover.cover_note ||
          "Ce dossier recapitule l'ensemble des demarches de recherche d'entreprise et le suivi des relances.",
        98,
        3
      );
      let noteY = 114;
      noteLines.forEach((nl) => {
        coverCmds.push(`BT /F1 9.5 Tf 74 ${noteY} Td (${nl}) Tj ET`);
        noteY -= 15;
      });

      // Cover Page Footer
      coverCmds.push('0.42 0.42 0.48 rg');
      coverCmds.push(
        `BT /F1 8.5 Tf 56 36 Td (Alt-Tracker Material Design 3.0  -  Dossier de suivi des candidatures de ${candName}) Tj ET`
      );
      coverCmds.push(`BT /F2 9 Tf 715 36 Td (Page 1 / ${totalPages}) Tj ET`);

      pageContents.push(coverCmds.join('\n'));
    }

    // --- Subsequent Pages: Paginated Applications Table ---
    chunks.forEach((pageApps, chunkIdx) => {
      const pageNumber = chunkIdx + 1 + (hasCoverPage ? 1 : 0);
      const cmds = [];

      // Header Banner
      cmds.push(`${palette.primary} rg`);
      cmds.push('30 515 782 54 re f');

      // Header Text (White)
      cmds.push('1 1 1 rg');
      const headerTitle = cleanPdfText(
        mergedCover.report_title || 'ALT-TRACKER - LISTE OFFICIELLE DES CANDIDATURES & ENVOIS',
        56
      );
      const candLabel = cleanPdfText(mergedCover.candidate_name || 'Matteo', 24);
      cmds.push(`BT /F2 14 Tf 44 544 Td (${headerTitle}  -  ${candLabel}) Tj ET`);
      cmds.push(
        `BT /F1 9.5 Tf 44 526 Td (Export PDF du ${genDate}  |  Total : ${apps.length} candidature(s)  |  Envoyees : ${stats.sentCount}  |  Taux de retour : ${stats.responseRate}%  |  Taux d'entretien : ${stats.interviewRate}%) Tj ET`
      );
      cmds.push(`BT /F2 10 Tf 735 536 Td (Page ${pageNumber} / ${totalPages}) Tj ET`);

      // Table Header Bar
      cmds.push(`${palette.container} rg`);
      cmds.push('30 484 782 24 re f');

      // Table Header Labels
      cmds.push(`${palette.darkText} rg`);
      cmds.push('BT /F2 8.5 Tf 38 493 Td (ENTREPRISE) Tj ET');
      cmds.push('BT /F2 8.5 Tf 155 493 Td (INTITULE DU POSTE) Tj ET');
      cmds.push('BT /F2 8.5 Tf 335 493 Td (CONTRAT) Tj ET');
      cmds.push('BT /F2 8.5 Tf 410 493 Td (STATUT) Tj ET');
      cmds.push('BT /F2 8.5 Tf 495 493 Td (VILLE & MODE) Tj ET');
      cmds.push('BT /F2 8.5 Tf 600 493 Td (DATE ENVOI) Tj ET');
      cmds.push('BT /F2 8.5 Tf 670 493 Td (RELANCE) Tj ET');
      cmds.push('BT /F2 8.5 Tf 735 493 Td (CONTACT / CV) Tj ET');

      let y = 460;
      if (pageApps.length === 0) {
        cmds.push('0.4 0.4 0.45 rg');
        cmds.push('BT /F1 11 Tf 38 450 Td (Aucune candidature correspondant aux filtres selectionnes.) Tj ET');
      } else {
        pageApps.forEach((app, idx) => {
          if (idx % 2 === 1) {
            cmds.push(`${palette.softBg} rg`);
            cmds.push(`30 ${y - 6} 782 22 re f`);
          }

          cmds.push('0.88 0.88 0.92 RG 0.5 w');
          cmds.push(`30 ${y - 6} m 812 ${y - 6} l S`);

          const company = cleanPdfText(app.company, 20);
          const role = cleanPdfText(app.role, 34);
          const typeLbl = cleanPdfText(TYPE_LABELS[app.type] || app.type, 13);
          const statusLbl = cleanPdfText(STATUS_LABELS[app.status] || app.status, 15);
          const locMode = cleanPdfText(
            `${app.location || '-'} (${workModeMap[app.work_mode] || app.work_mode || ''})`,
            19
          );
          const applied = cleanPdfText(app.applied_date || 'Brouillon', 11);
          const followup = cleanPdfText(app.follow_up_date || '-', 11);
          const contactOrCv = cleanPdfText(app.contact_name || app.cv_version || '-', 14);

          cmds.push('0.12 0.12 0.16 rg');
          cmds.push(`BT /F2 9 Tf 38 ${y} Td (${company}) Tj ET`);
          cmds.push(`BT /F1 8.5 Tf 155 ${y} Td (${role}) Tj ET`);
          cmds.push(`BT /F1 8.5 Tf 335 ${y} Td (${typeLbl}) Tj ET`);
          cmds.push(`BT /F2 8.5 Tf 410 ${y} Td (${statusLbl}) Tj ET`);
          cmds.push(`BT /F1 8 Tf 495 ${y} Td (${locMode}) Tj ET`);
          cmds.push(`BT /F1 8.5 Tf 600 ${y} Td (${applied}) Tj ET`);
          cmds.push(`BT /F1 8.5 Tf 670 ${y} Td (${followup}) Tj ET`);
          cmds.push(`BT /F1 8 Tf 735 ${y} Td (${contactOrCv}) Tj ET`);

          y -= 25;
        });
      }

      // Footer
      cmds.push('0.45 0.45 0.52 rg');
      cmds.push(
        `BT /F1 8 Tf 34 22 Td (Alt-Tracker Material Design 3.0  -  Dossier de ${candLabel} (${cleanPdfText(mergedCover.academic_year || '2026-2027', 16)})  -  Page ${pageNumber} / ${totalPages}) Tj ET`
      );

      pageContents.push(cmds.join('\n'));
    });

    // Assemble multi-page PDF objects
    const objects = [];
    const pageObjIds = pageContents.map((_, idx) => 5 + idx * 2);

    objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    objects.push(
      `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>\nendobj\n`
    );
    objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
    objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

    pageContents.forEach((streamStr, idx) => {
      const pageObjId = 5 + idx * 2;
      const contentObjId = 6 + idx * 2;
      objects.push(
        `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`
      );
      objects.push(
        `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamStr, 'utf8')} >>\nstream\n${streamStr}\nendstream\nendobj\n`
      );
    });

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const obj of objects) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += obj;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < offsets.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, 'utf8');
  }

  // --- MCP Connectors CRUD ---
  function listMcpConnectors() {
    let rows = db.prepare('SELECT * FROM mcp_connectors ORDER BY id ASC').all();
    if (rows.length === 0) {
      const now = nowIso();
      db.prepare(`
        INSERT INTO mcp_connectors (name, transport, endpoint_url, auth_token, enabled, tools_count, last_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'Alt-Tracker MCP Server (Local SQLite)',
        'http',
        'http://localhost:3000/api/mcp',
        '',
        1,
        22,
        'connected',
        now
      );
      rows = db.prepare('SELECT * FROM mcp_connectors ORDER BY id ASC').all();
    }
    return rows.map((r) => ({
      ...r,
      enabled: Boolean(r.enabled)
    }));
  }

  function createMcpConnector(data = {}) {
    const now = nowIso();
    const res = db.prepare(`
      INSERT INTO mcp_connectors (name, transport, endpoint_url, auth_token, enabled, tools_count, last_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      (data.name || 'Serveur MCP Externe').trim(),
      data.transport || 'http',
      (data.endpoint_url || '').trim(),
      (data.auth_token || '').trim(),
      data.enabled === false ? 0 : 1,
      Number(data.tools_count || 0),
      data.last_status || 'ready',
      now
    );
    return db.prepare('SELECT * FROM mcp_connectors WHERE id = ?').get(Number(res.lastInsertRowid));
  }

  function toggleMcpConnector(id, enabled) {
    db.prepare('UPDATE mcp_connectors SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, Number(id));
    return db.prepare('SELECT * FROM mcp_connectors WHERE id = ?').get(Number(id));
  }

  function updateMcpConnectorStatus(id, lastStatus, toolsCount) {
    db.prepare('UPDATE mcp_connectors SET last_status = ?, tools_count = ? WHERE id = ?').run(
      lastStatus,
      Number(toolsCount || 0),
      Number(id)
    );
    return db.prepare('SELECT * FROM mcp_connectors WHERE id = ?').get(Number(id));
  }

  function deleteMcpConnector(id) {
    const res = db.prepare('DELETE FROM mcp_connectors WHERE id = ?').run(Number(id));
    return res.changes > 0;
  }

  seedIfEmpty();
  ensureDocumentFiles();

  return {
    db,
    uploadsDir,
    listApplications,
    getApplicationById,
    createApplication,
    updateApplication,
    markFollowUpDone,
    addApplicationEvent,
    deleteApplication,
    listDocuments,
    getDocumentById,
    createDocument,
    updateDocument,
    deleteDocument,
    getAiSettings,
    saveAiSettings,
    getPdfSettings,
    savePdfSettings,
    getStats,
    exportCsv,
    exportApplicationsPdfBuffer,
    importApplications,
    listMcpConnectors,
    createMcpConnector,
    toggleMcpConnector,
    updateMcpConnectorStatus,
    deleteMcpConnector
  };
}

module.exports = {
  createDatabase,
  STATUS_LABELS,
  TYPE_LABELS
};
