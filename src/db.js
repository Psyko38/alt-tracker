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
    getStats,
    exportCsv,
    importApplications
  };
}

module.exports = {
  createDatabase,
  STATUS_LABELS,
  TYPE_LABELS
};
