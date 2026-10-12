# 🎯 Alt-Tracker — Suivi de Candidatures & Copilote IA (Material Design 3.0)

Application web locale complète en **Node.js (Express 5 + SQLite natif `node:sqlite`)** adoptant le système visuel **Google Material Design 3.0 (Material You)** pour piloter vos candidatures d’**alternance**, **emploi (CDI/CDD)**, **stage**, **freelance** et **autres opportunités**, avec **Studio Agent IA intégré**, **générateur de rapports PDF** et **serveur Model Context Protocol (MCP)** natif.

---

## ✨ Fonctionnalités Principales

### 🎨 Design System Google Material 3.0 (Material You)
- **Navigation Rail** avec **Extended FAB**, compteurs dynamiques et barre de navigation mobile responsive.
- **5 Palettes dynamiques Material You** (*Iris*, *Émeraude*, *Océan*, *Terracotta*, *Cerise*) + bascule **Mode Clair / Sombre** persistée.
- **Composants MD3 sur-mesure** : sélecteurs déroulants personnalisés (`Exposed Dropdown Menus`), zone de dépôt de fichiers stylisée (`Drag & Drop File Picker`), `Filter Chips` tonals et typographie **Outfit + Plus Jakarta Sans**.

### 🗂️ 6 Vues Complémentaires
1. **Tableau de bord (`Dashboard`)** :
   - KPIs temps réel (candidatures totales, processus actifs, taux de retour, taux d’entretien, relances dues).
   - Listes d’actions prioritaires (*Relances urgentes*, *Prochains entretiens*), répartition par type de contrat et **taux de conversion par version de CV**.
2. **Pipeline Kanban (`Drag & Drop`)** :
   - 6 colonnes interactives : *À postuler (Brouillon)*, *Envoyée*, *Entretien RH*, *Test / Tech*, *Offre reçue*, *Refusée*.
   - Glisser-déposer natif qui met à jour le statut et ajoute automatiquement une entrée datée dans la timeline.
3. **Vue Liste & Export PDF Paysage A4** :
   - Tableau triable et filtrable (contrat, statut, favoris, relances à faire, recherche plein texte).
   - **Aperçu PDF dans la page** et **Téléchargement PDF A4 Paysage** multi-pages respectant vos filtres actifs.
4. **Agenda des Relances & Entretiens** :
   - Suivi des relances en retard ou prévues dans les 3 prochains jours.
   - Action rapide **« Marquer relancé (+7j) »** en 1 clic.
5. **Bibliothèque CV & Lettres de motivation (Visionneuse intégrée)** :
   - Stockage local de vos fichiers PDF/Images/DOCX (`data/uploads/`) ou liens externes (GitHub, Portfolio, Notion).
   - **Visionneuse de documents in-page** (`#doc-preview-backdrop`) permettant d’ouvrir et lire vos CV et lettres PDF directement dans la page sans quitter l’application, y compris depuis les cartes Kanban, la liste ou le panneau latéral.
6. **Studio Agent IA (`Copilote IA`)** :
   - Interface inspirée de **Google Gemini Studio** avec cartes Bento 2×2, dock de saisie flottant et rendu complet **GitHub Flavored Markdown (GFM)** (titres, tableaux, listes, citations, blocs de code).
   - **Compatible OpenAI API (`/v1/chat/completions`)** : pré-réglages rapides pour **OpenAI**, **Groq**, **Mistral AI**, **OpenRouter** et **Ollama (local)**, plus un **mode autonome local sans clé API** qui fonctionne hors-ligne.
   - **Function Calling connecté à SQLite** : l’IA consulte vos stats, crée/modifie des candidatures, valide des relances et **génère automatiquement des lettres de motivation en PDF** directement dans votre bibliothèque.
   - **Smart Job Parser IA** : collez le texte brut d’une annonce (LinkedIn, Welcome to the Jungle, Indeed) pour pré-remplir le formulaire ou créer la candidature en 1 clic.

### 📄 Rapports & Import / Export Multi-formats
- **Export PDF Officiel (Paysage A4)** : rapport multi-pages vectoriel généré nativement sans dépendance externe (bannière Material 3 Deep Iris, résumé KPI, tableau zébré paginé).
- **Import / Export CSV & JSON** : sauvegarde complète ou ouverture directe dans Excel / Google Sheets / Notion.

---

## 🔌 Connecteur Model Context Protocol (MCP `2024-11-05`)

Alt-Tracker intègre un **serveur MCP natif** supportant à la fois le transport **`stdio`** (pour **Claude Desktop**, **Cursor**, **Antigravity**, etc.) et **`HTTP JSON-RPC 2.0`** (`/api/mcp`), ainsi qu’un **Hub MCP** dans l’interface pour gérer des serveurs MCP externes.

### Configuration `stdio` (Claude Desktop / Cursor / Antigravity)

Ajoutez la configuration suivante dans votre fichier `claude_desktop_config.json` ou `.cursor/mcp.json` (également copiable en 1 clic depuis le bouton **Connecteur MCP** dans l’application) :

```json
{
  "mcpServers": {
    "alt-tracker": {
      "command": "node",
      "args": [
        "/chemin/absolu/vers/alt-tracker/src/mcp-server.js"
      ]
    }
  }
}
```

### Endpoint HTTP JSON-RPC 2.0
- **URL** : `POST http://localhost:3000/api/mcp`
- **Métadonnées & Découverte** : `GET http://localhost:3000/api/mcp/info`

### Outils (`Tools`), Ressources (`Resources`) & `Prompts` MCP exposés

| Type MCP | Nom | Description |
|---|---|---|
| **Tool** | `list_applications` | Liste et filtre les candidatures (`type`, `status`, `search`, `due_followup`, `favorite`) |
| **Tool** | `get_application` | Récupère les détails complets et la timeline d’une candidature par ID |
| **Tool** | `create_application` | Crée une nouvelle candidature dans SQLite avec événement initial |
| **Tool** | `update_application_status` | Met à jour le statut d’une candidature et journalise le changement |
| **Tool** | `mark_follow_up_done` | Enregistre une relance effectuée et décale la prochaine échéance (`+7j`) |
| **Tool** | `get_pipeline_stats` | Retourne les KPIs globaux, taux de conversion et relances urgentes |
| **Tool** | `generate_cover_letter_pdf` | Génère un fichier PDF de lettre de motivation et l’ajoute à la bibliothèque |
| **Resource** | `alt-tracker://applications` | Flux JSON complet des candidatures |
| **Resource** | `alt-tracker://stats` | Statistiques et KPIs du pipeline en temps réel |
| **Resource** | `alt-tracker://documents` | Catalogue des CV et lettres de motivation enregistrés |
| **Prompt** | `audit-pipeline` | Prompt pré-configuré d’audit complet du pipeline et des priorités |
| **Prompt** | `draft-followup` | Prompt de rédaction de relance email + LinkedIn pour une candidature |
| **Prompt** | `tailor-cover-letter` | Prompt de rédaction et génération PDF d’une lettre de motivation ciblée |

---

## 🚀 Installation & Démarrage Rapide

### Prérequis
- **Node.js `>= 22.5.0`** (utilise le module natif `node:sqlite` intégré à Node.js, aucune compilation C++ externe requise).

### Commandes

```bash
# 1. Installer les dépendances
npm install

# 2. Démarrer le serveur web (http://localhost:3000)
npm start

# 3. Mode développement (rechargement automatique)
npm run dev

# 4. Démarrer le serveur MCP en mode stdio (pour agents IA externes)
npm run mcp

# 5. Exécuter la suite de tests d'intégration (API REST, SQLite, PDF, IA, MCP)
npm test
```

Par défaut, au premier lancement, une base SQLite locale est initialisée dans `data/alt-tracker.sqlite` avec un jeu de candidatures et de CV de démonstration (désactivable avec `SEED_SAMPLE_DATA=false`).

---

## 📁 Architecture du Projet

```text
alt-tracker/
├── data/
│   ├── alt-tracker.sqlite     # Base de données SQLite locale (créée automatiquement)
│   └── uploads/               # Fichiers PDF/Images uploadés et lettres PDF générées
├── public/
│   ├── index.html             # Interface Material Design 3.0 (6 vues + modales + Side Sheet)
│   ├── css/
│   │   └── styles.css         # Système de tokens MD3, 5 thèmes, Dark Mode, Studio IA & Markdown GFM
│   └── js/
│       └── app.js             # Logique frontend SPA, Kanban Drag & Drop, Visionneuse PDF, Parseur GFM & Hub MCP
├── src/
│   ├── server.js              # Serveur Express 5 & routes API REST / PDF / IA / MCP
│   ├── db.js                  # Couche SQLite (node:sqlite), migrations, statistiques & générateurs PDF natifs
│   ├── ai-agent.js            # Agent IA (OpenAI-compatible + Function Calling + Fallback local + Job Parser)
│   └── mcp-server.js          # Serveur Model Context Protocol (stdio + HTTP JSON-RPC 2.0)
├── tests/
│   └── api.test.js            # Tests d'intégration automatisés (node:test)
└── package.json
```

---

## 🌐 Référence Rapide de l’API REST

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/applications` | Liste des candidatures (filtres `type`, `status`, `search`, `due_followup`, `favorite`, `sort`) |
| `GET` | `/api/applications/:id` | Détail d’une candidature + historique `events` |
| `POST` | `/api/applications` | Créer une candidature |
| `PUT` | `/api/applications/:id` | Modifier une candidature |
| `PATCH` | `/api/applications/:id/status` | Changer rapidement le statut (Kanban / Liste) |
| `POST` | `/api/applications/:id/follow-up` | Marquer une relance effectuée et reprogrammer à `+N` jours |
| `POST` | `/api/applications/:id/events` | Ajouter une étape au journal de suivi |
| `DELETE` | `/api/applications/:id` | Supprimer une candidature |
| `GET` | `/api/stats` | Statistiques globales, entonnoir et relances urgentes |
| `GET / POST` | `/api/documents` | Lister ou ajouter un document CV / Lettre de motivation |
| `GET` | `/api/documents/:id/view` | Visualiser un PDF/Image en ligne (`inline`) |
| `GET` | `/api/documents/:id/download` | Télécharger le fichier d’un document |
| `GET` | `/api/export/pdf` | Générer le rapport PDF Paysage A4 de la liste des envois (`?inline=1` pour aperçu) |
| `GET` | `/api/export/csv` | Exporter les candidatures au format CSV (UTF-8 BOM) |
| `GET` | `/api/export/json` | Exporter une sauvegarde complète JSON |
| `POST` | `/api/import` | Importer des candidatures depuis un fichier CSV ou JSON |
| `GET / PUT` | `/api/ai/settings` | Lire ou configurer le fournisseur IA (OpenAI, Groq, Mistral, Ollama...) |
| `POST` | `/api/ai/chat` | Envoyer un message au Copilote IA avec exécution d’outils |
| `POST` | `/api/ai/extract-job` | Extraire les champs structurés d’une offre d’emploi brute |
| `GET` | `/api/mcp/info` | Informations du serveur MCP, outils exposés et configuration JSON |
| `POST` | `/api/mcp` | Endpoint MCP JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`, etc.) |
| `GET / POST` | `/api/mcp/connectors` | Lister ou connecter un serveur MCP externe |

---

## ⌨️ Raccourcis Clavier

| Touche | Action |
|---|---|
| `N` | Ouvrir la modale **Nouvelle candidature** |
| `/` | Placer le curseur dans la **barre de recherche globale** |
| `Échap` | Fermer la modale active, la visionneuse PDF, le menu déroulant ou le panneau latéral |
