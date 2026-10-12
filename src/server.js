const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { createDatabase } = require('./db');

function createApp(customDbPath) {
  const app = express();
  const store = createDatabase(customDbPath);

  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // --- Applications CRUD ---
  app.get('/api/applications', (req, res) => {
    try {
      const items = store.listApplications(req.query);
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/applications/:id', (req, res) => {
    try {
      const item = store.getApplicationById(req.params.id);
      if (!item) return res.status(404).json({ error: 'Candidature introuvable' });
      res.json(item);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/applications', (req, res) => {
    try {
      const { company, role } = req.body || {};
      if (!company || !role || !company.trim() || !role.trim()) {
        return res.status(400).json({ error: 'Les champs entreprise et poste sont obligatoires.' });
      }
      const created = store.createApplication(req.body);
      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/applications/:id', (req, res) => {
    try {
      const updated = store.updateApplication(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Candidature introuvable' });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/applications/:id/status', (req, res) => {
    try {
      const { status, note } = req.body || {};
      if (!status) return res.status(400).json({ error: 'Le statut est requis.' });
      const updated = store.updateApplication(req.params.id, {
        status,
        status_note: note
      });
      if (!updated) return res.status(404).json({ error: 'Candidature introuvable' });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/applications/:id/follow-up', (req, res) => {
    try {
      const updated = store.markFollowUpDone(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Candidature introuvable' });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/applications/:id/events', (req, res) => {
    try {
      const { title } = req.body || {};
      if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Le titre de l’événement est requis.' });
      }
      const updated = store.addApplicationEvent(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Candidature introuvable' });
      res.status(201).json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/applications/:id', (req, res) => {
    try {
      const deleted = store.deleteApplication(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Candidature introuvable' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Dashboard Stats ---
  app.get('/api/stats', (_req, res) => {
    try {
      res.json(store.getStats());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Documents (CV / Cover Letters) ---
  app.get('/api/documents', (_req, res) => {
    try {
      res.json(store.listDocuments());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/documents', (req, res) => {
    try {
      const { label } = req.body || {};
      if (!label || !label.trim()) {
        return res.status(400).json({ error: 'Le nom du document est requis.' });
      }
      const doc = store.createDocument(req.body);
      res.status(201).json(doc);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/documents/:id/download', (req, res) => {
    try {
      const doc = store.getDocumentById(req.params.id);
      if (!doc || !doc.stored_name) {
        return res.status(404).json({ error: 'Fichier introuvable pour ce document.' });
      }
      const filePath = path.join(store.uploadsDir, doc.stored_name);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Fichier absent du disque.' });
      }
      res.download(filePath, doc.file_name || doc.stored_name);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/documents/:id', (req, res) => {
    try {
      const ok = store.deleteDocument(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Document introuvable' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Export / Import ---
  app.get('/api/export/json', (_req, res) => {
    try {
      const applications = store.listApplications({});
      const documents = store.listDocuments();
      const payload = {
        exported_at: new Date().toISOString(),
        version: '1.0',
        applications,
        documents
      };
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="alt-tracker-export.json"');
      res.send(JSON.stringify(payload, null, 2));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/export/csv', (_req, res) => {
    try {
      const csv = store.exportCsv();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="alt-tracker-candidatures.csv"');
      res.send('\uFEFF' + csv);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/import', (req, res) => {
    try {
      const imported = store.importApplications(req.body || {});
      res.status(201).json({
        imported_count: imported.length,
        applications: imported
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.locals.store = store;
  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`✨ Alt-Tracker (Material Design 3.0) démarré sur http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
