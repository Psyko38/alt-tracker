const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/server');

describe('Alt-Tracker REST API & SQLite Integration Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.SEED_SAMPLE_DATA = 'false';
    const app = createApp(':memory:');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await res.json() : await res.text();
    return { status: res.status, body, headers: res.headers };
  }

  let createdAppId;

  test('POST /api/applications creates a new alternance application with initial timeline event', async () => {
    const res = await request('/api/applications', {
      method: 'POST',
      body: JSON.stringify({
        company: 'Airbus',
        role: 'Apprenti Ingénieur Logiciel Fullstack Node.js',
        type: 'alternance',
        status: 'applied',
        priority: 'high',
        location: 'Toulouse',
        work_mode: 'hybrid',
        salary: '1 700 € / mois',
        rhythm: '1 mois / 1 mois',
        applied_date: '2026-10-01',
        follow_up_date: '2026-10-08',
        contact_name: 'Jean Dupont',
        contact_email: 'j.dupont@airbus.example.com',
        cv_version: 'CV Alternance Aero v1'
      })
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.company, 'Airbus');
    assert.equal(res.body.type, 'alternance');
    assert.equal(res.body.status, 'applied');
    assert.equal(Array.isArray(res.body.events), true);
    assert.equal(res.body.events.length, 1);
    assert.equal(res.body.events[0].event_type, 'created');
    createdAppId = res.body.id;
  });

  test('GET /api/applications filters by type, status, and search query', async () => {
    await request('/api/applications', {
      method: 'POST',
      body: JSON.stringify({
        company: 'Stripe',
        role: 'Backend Engineer',
        type: 'job',
        status: 'interview',
        location: 'Paris / Remote'
      })
    });

    const allRes = await request('/api/applications');
    assert.equal(allRes.status, 200);
    assert.equal(allRes.body.length, 2);

    const altRes = await request('/api/applications?type=alternance');
    assert.equal(altRes.body.length, 1);
    assert.equal(altRes.body[0].company, 'Airbus');

    const searchRes = await request('/api/applications?search=stripe');
    assert.equal(searchRes.body.length, 1);
    assert.equal(searchRes.body[0].company, 'Stripe');
  });

  test('PATCH /api/applications/:id/status updates status and records a status_change event', async () => {
    const res = await request(`/api/applications/${createdAppId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'interview', note: 'Invitation reçue par email' })
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'interview');
    const hasStatusEvent = res.body.events.some((e) => e.event_type === 'status_change');
    assert.equal(hasStatusEvent, true);
  });

  test('POST /api/applications/:id/follow-up records follow-up and shifts follow_up_date', async () => {
    const res = await request(`/api/applications/${createdAppId}/follow-up`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Relance téléphonique effectuée', nextFollowUpDays: 7 })
    });

    assert.equal(res.status, 200);
    const hasFollowUpEvent = res.body.events.some((e) => e.event_type === 'follow_up');
    assert.equal(hasFollowUpEvent, true);
    assert.notEqual(res.body.follow_up_date, '2026-10-08');
  });

  test('POST /api/applications/:id/events adds a custom timeline event', async () => {
    const res = await request(`/api/applications/${createdAppId}/events`, {
      method: 'POST',
      body: JSON.stringify({
        event_type: 'interview',
        title: 'Entretien technique avec le Lead Dev'
      })
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.events[0].title, 'Entretien technique avec le Lead Dev');
  });

  test('POST & GET /api/documents manages CV library with base64 file upload', async () => {
    const base64Pdf = Buffer.from('%PDF-1.4 sample cv content').toString('base64');
    const createRes = await request('/api/documents', {
      method: 'POST',
      body: JSON.stringify({
        label: 'CV Alternance Aero',
        doc_type: 'cv',
        version_tag: 'v1',
        file_name: 'cv_aero.pdf',
        file_base64: base64Pdf
      })
    });

    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.label, 'CV Alternance Aero');
    const docId = createRes.body.id;

    const listRes = await request('/api/documents');
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.length, 1);

    const viewRes = await request(`/api/documents/${docId}/view`);
    assert.equal(viewRes.status, 200);
    assert.equal((viewRes.headers.get('content-disposition') || '').includes('inline'), true);
    assert.equal(viewRes.body.includes('%PDF-1.4'), true);

    const updRes = await request(`/api/documents/${docId}`, {
      method: 'PUT',
      body: JSON.stringify({ version_tag: 'v2.0', label: 'CV Alternance Aero v2' })
    });
    assert.equal(updRes.status, 200);
    assert.equal(updRes.body.version_tag, 'v2.0');

    const dlRes = await request(`/api/documents/${docId}/download`);
    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.body.includes('%PDF-1.4'), true);

    const delRes = await request(`/api/documents/${docId}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);
  });

  test('GET /api/export/csv and POST /api/import round-trip applications', async () => {
    const csvRes = await request('/api/export/csv');
    assert.equal(csvRes.status, 200);
    assert.equal(csvRes.body.includes('Airbus'), true);

    const importRes = await request('/api/import', {
      method: 'POST',
      body: JSON.stringify({
        applications: [
          {
            company: 'Thales',
            role: 'Stage Cybersécurité & Cloud',
            type: 'stage',
            status: 'draft'
          }
        ]
      })
    });

    assert.equal(importRes.status, 201);
    assert.equal(importRes.body.imported_count, 1);
  });

  test('GET /api/stats returns accurate KPIs and breakdowns', async () => {
    const statsRes = await request('/api/stats');
    assert.equal(statsRes.status, 200);
    assert.equal(statsRes.body.total, 3);
    assert.equal(statsRes.body.byType.alternance, 1);
    assert.equal(statsRes.body.byType.job, 1);
    assert.equal(statsRes.body.byType.stage, 1);
  });

  test('GET & PUT /api/ai/settings manages OpenAI-compatible AI settings and masks API key', async () => {
    const getRes = await request('/api/ai/settings');
    assert.equal(getRes.status, 200);
    assert.equal(typeof getRes.body.base_url, 'string');
    assert.equal(getRes.body.candidate_name, 'Matteo');

    const putRes = await request('/api/ai/settings', {
      method: 'PUT',
      body: JSON.stringify({
        base_url: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        candidate_name: 'Matteo Dev'
      })
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.base_url, 'https://api.groq.com/openai/v1');
    assert.equal(putRes.body.model, 'llama-3.3-70b-versatile');
    assert.equal(putRes.body.candidate_name, 'Matteo Dev');
  });

  test('POST /api/ai/chat generates follow-up, cover letter PDF, and interview coaching autonomously', async () => {
    const followUpRes = await request('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        focusAppId: createdAppId,
        messages: [{ role: 'user', content: 'Rédige un email de relance pour Airbus' }]
      })
    });
    assert.equal(followUpRes.status, 200);
    assert.equal(followUpRes.body.reply.includes('Airbus'), true);

    const clRes = await request('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        focusAppId: createdAppId,
        messages: [{ role: 'user', content: 'Génère une lettre de motivation PDF pour Airbus' }]
      })
    });
    assert.equal(clRes.status, 200);
    assert.equal(Boolean(clRes.body.documentCreated), true);
    assert.equal(clRes.body.documentCreated.doc_type, 'cover_letter');

    // Clean up generated PDF
    await request(`/api/documents/${clRes.body.documentCreated.id}`, { method: 'DELETE' });
  });

  test('POST /api/ai/extract-job parses raw job offer text and optionally creates application', async () => {
    const rawOffer = [
      'Entreprise : Doctolib',
      'Poste : Alternance Développeur Fullstack Node.js',
      'Lieu : Paris (Hybride)',
      'Salaire : 1 800 € / mois',
      'Rythme : 3 semaines entreprise / 1 semaine école',
      'Contact : jobs@doctolib.example.com'
    ].join('\n');

    const extractRes = await request('/api/ai/extract-job', {
      method: 'POST',
      body: JSON.stringify({ text: rawOffer, autoCreate: true })
    });
    assert.equal(extractRes.status, 200);
    assert.equal(extractRes.body.extracted.company, 'Doctolib');
    assert.equal(extractRes.body.extracted.type, 'alternance');
    assert.equal(Boolean(extractRes.body.created), true);
    assert.equal(extractRes.body.created.company, 'Doctolib');
  });

  test('DELETE /api/applications/:id removes application', async () => {
    const delRes = await request(`/api/applications/${createdAppId}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    const getRes = await request(`/api/applications/${createdAppId}`);
    assert.equal(getRes.status, 404);
  });
});
