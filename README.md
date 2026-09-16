# 🎯 Suivi de candidatures

Application Node.js pour suivre vos candidatures (jobs, alternance, stages) : interface en une page + **API auto-documentée pour agents IA** (REST et MCP). SQLite est l'unique stockage.

## Lancer / tester

```bash
npm install      # install le projet
npm start        # → http://localhost:3000   (ou npm run dev avec rechargement)
npm test         # tests node --test, chaque test dans une base temporaire
npm run mcp      # serveur MCP standalone (stdio JSON-RPC, zéro dépendance)
node scripts/migrate-json.js data/applications.json data/cover.json   # migration unique depuis l'ancien JSON
```

Le suivi démarre vide : ajoutez votre première candidature avec le bouton **Nouvelle candidature** (ou la touche `N`), ou importez une sauvegarde JSON existante depuis *Exporter → Importer*.

## Fonctionnalités

### 🖥️ Interface en une page

- **Tableau de bord en widgets** : chaque bloc est une carte qu'on **déplace** par sa
  poignée (glisser-déposer HTML5 ou deux boutons « déplacer à gauche / à droite » au
  clavier), qu'on **redimensionne** (1/6 à pleine largeur — un graphique refuse de
  descendre sous ce qu'il peut montrer) et qu'on **retire ou remet** depuis le menu
  *Widgets*. Trois modes d'emploi : *Organiser* (ou `Échap`) révèle les poignées, les
  largeurs et les croix de retrait en gelant le contenu des cartes ; le menu *Widgets*
  liste toutes les cartes disponibles, rangées par famille (indicateurs, graphiques,
  liste) ; *Réinitialiser* (proposé seulement quand la disposition a bougé) repose celle
  d'origine. La disposition — ordre, largeurs, cartes affichées — est mémorisée par
  navigateur (`jt-dashboard`) : une largeur inconnue reprend son défaut, un widget d'une
  autre version est oublié, un doublon est ignoré, et un widget arrivé depuis est ajouté
  à la suite. Les six indicateurs (Candidatures, Envoyées, Entretiens en cours, Taux de
  réponse, Refus, À relancer), les trois graphiques, le rendement de la recherche, la
  barre de recherche et filtres, et la liste sont les onze cartes du catalogue. Sous
  880 px, la grille se replie en deux colonnes, puis en une
- Thème clair/sombre (mémorisé, suit le système par défaut)
- **Cartes de stats cliquables** : envoyées, entretiens, refus, à relancer — un clic filtre la liste
- Filtres en pastilles avec compteurs (statut, type), filtre « à relancer », tri et recherche instantanée (entreprise, poste, lieu, contact, notes…)
- **Plage de dates** (« du … au … ») sur la date de démarche ou la prochaine action, bornes incluses
- **Édition en un clic** dans le tableau : `Entrée` enregistre, `Échap` annule ; en-têtes triables
- **15 colonnes au choix**, préférence mémorisée par navigateur (Téléphone et Notes affichées d'origine)
- Historique des statuts horodaté, affiché dans la modale
- Détection de doublons avant enregistrement
- Téléphone remis automatiquement à sa place : un numéro saisi dans le champ e-mail est déplacé dans **Téléphone** (l'e-mail exporté reste propre)
- Bandeau de relances quand une action est due ou qu'une étape dort ; notifications discrètes au lieu des `alert()`
- Dashboard Chart.js : évolution sur 12 mois, répartitions par statut et type
- **Rendement de la recherche** : entonnoir (envoyées → réponses → entretiens → offres),
  délai moyen avant la première réponse et taux de réponse par canal (LinkedIn, HelloWork…).
  Tout est déduit du statut et de l'historique horodaté : rien à saisir en plus. Les
  chiffres sont ceux de `GET /api/dashboard` — la carte les affiche tels quels plutôt
  que de les recalculer, et « envoyée » veut dire la même chose dans la carte, dans le
  filtre rapide et dans la première marche de l'entonnoir
- Responsive (cartes sous 880 px), raccourcis clavier (`N`, `/`/`S`, `Échap`), accessibilité ARIA

### 🔔 Règle de relance

Le compteur repart du **dernier mouvement réel** (changement de statut horodaté, sinon la date de démarche) — pas de la date de démarche seule. Délais par étape : **14 j** après « Postulé », **10 j** après « Relance envoyée », **7 j** après « Entretien » (statut inconnu importé → 14 j). Aucune relance pour « À postuler », « Refus », « Sans réponse », « Offre reçue ». Dès qu'une date de prochaine action est posée, elle fait foi.

### 🗂️ Données

- Statuts : À postuler · Postulé · Relance envoyée · Entretien · Offre reçue · Refus · Sans réponse
- Types : CDI · CDD · Alternance · Stage · Freelance
- Colonnes : Entreprise, Poste, Type, Statut, Date de démarche, Dernier mouvement, Code postal, Lieu, Source, Salaire, Lien, Contact (Nom · Téléphone · Mail), Prochaine action, Notes
- Base `data/applications.sqlite` créée automatiquement ; chaque écriture est une
  **transaction SQLite**. Dossier `data/` : `applications.sqlite`, `backups/`
  (instantanés de sécurité), `exports/` (fichiers produits par le MCP)
- **Filet de sécurité** : un instantané de la base est pris à chaque démarrage et juste avant
  toute opération destructrice (suppression, import en remplacement), dans `data/backups/`.
  Les 10 plus récents sont conservés, se listent et se restaurent depuis *Exporter → Sauvegardes*
  (ou `GET /api/backups`). Chaque instantané annonce sa date à la seconde et le nombre de
  fiches qu'il contient ; une restauration copie l'état écrasé avant d'écraser, donc elle est
  elle-même réversible. **Sans instantané possible (dossier en lecture seule, disque plein),
  l'opération est refusée avec le motif** : mieux vaut ne rien supprimer que de supprimer
  sans filet

### 📤 Export / Import — « exporter ce que je vois »

Le PDF et le CSV suivent la sélection affichée (filtres, recherche) ; la sauvegarde JSON est toujours complète.

- **PDF A4 paysage**, multi-pages, généré sans dépendance : largeurs de colonnes adaptées au contenu, contact sur trois colonnes, **page de garde optionnelle** (titre, sous-titre, texte libre, indicateurs) éditée depuis *Exporter → 🖼️ Page de garde* ou `PUT /api/cover`
- **CSV compatible Excel FR** (« ; » + BOM UTF-8), téléphone du contact inclus
- **Sauvegarde JSON** : candidatures + page de garde, réimportables. Import en mode fusion (doublons d'id ignorés) ou remplacement (copie horodatée de la base SQLite faite automatiquement avant, nom renvoyé dans le résumé)

### 🛡️ Sécurité par défaut

- Écoute sur `127.0.0.1` uniquement ; `API_KEY=… npm start` protège les **écritures** (en-tête `X-API-Key` ou Bearer, comparaison timing-safe), lectures ouvertes
- CORS activé, corps limités à 2 Mo, champs bornés, dates/e-mails/URL validées

## 🤖 API pour agents IA

### REST — auto-documentée

`GET /api` renvoie **tout ce qu'un agent doit savoir** (routes, champs, enums) : un agent n'a besoin que de cette URL. `GET /api/openapi.json` (OpenAPI 3.1) et `GET /api/schema` complètent.

| Méthode | Route | Description |
|---|---|---|
| GET | `/api` | Catalogue auto-documenté (point de départ pour un agent) |
| GET | `/api/applications` | Lister — filtres : `status`, `type`, `company`, `q`, `followup`, `quick`, `from`, `to`, `dateField`, `sort`, `dir`, `limit` |
| GET | `/api/applications/:id` | Détail d'une candidature |
| POST | `/api/applications` | Créer (`company` et `position` requis) |
| PUT / PATCH | `/api/applications/:id` | Modifier (PUT fusion, PATCH partiel) |
| POST | `/api/applications/:id/status` | Raccourci : `{ "status": "Entretien" }` |
| DELETE | `/api/applications/:id` | Supprimer |
| GET | `/api/export` | Sauvegarde JSON complète (jamais filtrée) |
| GET | `/api/export/csv` · `/api/export/pdf` | Export CSV / PDF, **mêmes filtres que l'interface** |
| POST | `/api/import` | Import JSON — `?mode=merge` (défaut) ou `replace`, page de garde restaurée |
| GET | `/api/backups` | Lister les instantanés de sécurité (`keep`, `files` avec date, taille et nombre de fiches) |
| POST | `/api/backups` | Créer un instantané à la demande |
| POST | `/api/backups/restore` | Restaurer un instantané — `{ "name": "applications-….sqlite" }` |
| GET / PUT / PATCH | `/api/cover` | Page de garde du PDF (`enabled`, `title`, `subtitle`, `text`, `showStats`) |
| GET | `/api/stats` · `/api/dashboard` | Statistiques / séries du dashboard |

Validation : `company`/`position` obligatoires (sinon `400`), statuts hors liste refusés avec la liste des valeurs, dates `AAAA-MM-JJ` ou `JJ/MM/AAAA`, erreurs `400`/`404`/`405` (+ en-tête `Allow`)/`413`. Exemple :

```bash
curl -X POST http://localhost:3000/api/applications \
  -H "Content-Type: application/json" \
  -d '{"company":"Google","position":"Dev Front-end","status":"Postulé","source":"LinkedIn"}'
```

### MCP — Model Context Protocol

Pour les agents qui parlent MCP (Claude Desktop, Cursor…) : `npm run mcp`, ou dans la config client :

```json
{ "mcpServers": { "job-tracker": { "command": "node", "args": ["/chemin/vers/job-tracker/mcp-server.js"] } } }
```

18 outils exposés :

| Outil | Rôle |
|---|---|
| `get_schema` | Catalogue : champs, statuts/types autorisés, délais de relance, options page de garde, analyses (`insights`) et sauvegardes |
| `list_applications` / `get_application` | Lister (filtres) / détail par id |
| `create_application` / `update_application` / `set_status` / `delete_application` | CRUD complet |
| `get_stats` / `get_followups` | Statistiques / candidatures à relancer |
| `get_cover` / `set_cover` | Page de garde du PDF (fusion des champs) |
| `export_applications` / `export_csv` / `export_pdf` | Écrivent un **fichier** et renvoient son chemin (`data/exports/candidatures-AAAA-MM-JJ.<ext>` ou le `path` demandé), avec les filtres de sélection pour CSV/PDF |
| `import_applications` | Depuis `data` (JSON) ou `path` (fichier), mode `merge`/`replace` |
| `list_backups` / `create_backup` / `restore_backup` | Lister, créer ou restaurer un instantané — le même filet que l'interface, pour l'agent aussi |

Les outils MCP et l'API REST partagent la même logique (la couche `lib/`, d'un bout à l'autre : base, modèle, instantanés, exports) : mêmes règles, mêmes fichiers, même format de sauvegarde — un export fait d'un côté se restaure de l'autre.

## Structure

```
server.js            # Serveur HTTP + REST API (humains + agents IA)
mcp-server.js        # Serveur MCP stdio (agents compatibles)
lib/rules.js         # Règles communes (relances, statuts, dates, sélection) — chargées AUSSI par la page
lib/fields.js        # Schéma des champs d'une candidature (types, limites, obligatoires)
lib/model.js         # Modèle : normalisation (dates, coordonnées) et validation
lib/sqlite.js        # La base : fichier, connexion, schéma, lecture/écriture des lignes
lib/store.js         # Opérations sur les candidatures (créer, lire, modifier, supprimer, lister)
lib/backups.js       # Instantanés de la base : quand, où, combien, et la restauration
lib/cover.js         # Page de garde du PDF
lib/import.js        # Import d'un fichier (fusion ou remplacement)
lib/stats.js         # Lecture agrégée : statistiques et tableau de bord
lib/errors.js        # Erreurs métier typées (entrée invalide, introuvable, refus sans filet)
lib/api-contract.js  # Contrat de l'API (catalogue, OpenAPI, validation) — une seule table de routes
lib/pdf.js           # Générateur PDF sans dépendance
lib/export.js        # Exports partagés (CSV, sauvegarde JSON, écriture des fichiers)
lib/files.js         # Écritures de fichiers tout-ou-rien (tmp + rename), empreinte
lib/snapshots.js     # Mécanique des instantanés : copie datée, rotation, contrôle d'intégrité
scripts/migrate-json.js  # Migration explicite JSON → SQLite (une seule fois)
public/index.html    # Page unique + tableau de bord « bento » (widgets + Chart.js)
public/app.js        # Point d'entrée : assemble les modules, orchestre le rendu
public/js/state.js   # État partagé + registre des éléments du DOM
public/js/ui.js      # Primitives d'affichage : icônes, pastilles, notifications, état vide
public/js/shell.js   # Ossature : modales, menus, thème, focus, confirmation
public/js/render.js  # Déclencheur de rendu unique
public/js/api.js     # Appels REST et chargement des données
public/js/columns.js # Définition des colonnes, préférences, menu « Colonnes »
public/js/filters.js # Recherche, filtres, sélection affichée
public/js/dashboard.js # Tableau de bord bento : catalogue de widgets (quels widgets existent, quelles largeurs), disposition mémorisée, glisser-déposer, ajout/retrait
public/js/overview.js # Indicateurs (un widget chacun), rendement de la recherche, graphiques
public/js/table.js   # Tableau Tabulator, contenu des cellules, édition en ligne
public/js/entries.js # Fiche candidature : ajout, édition, suppression, doublons
public/js/cover.js   # Page de garde du PDF
public/js/backups.js # Instantanés de la base (lister, créer, restaurer)
public/js/transfer.js # Import JSON et exports (JSON, PDF, CSV)
public/style.css     # Styles
test/*.test.js       # Tests node --test, base SQLite temporaire (helpers.js : outillage commun)
data/                # applications.sqlite, backups/ (instantanés), exports/ (produits par le MCP)
```

Les tests vérifient aussi l'architecture : le graphe d'imports du front
(`public-modules.test.js`), les couches de la couche serveur et l'unicité de la porte
des règles (`lib-layers.test.js`), le catalogue/gabarits des widgets
(`dashboard-layout.test.js`, `dashboard-lifecycle.test.js`) et le rendu du tableau hors
navigateur (`table-render.test.js`).

Une seule logique, deux exécutants : `lib/rules.js` est un module **dual** — `require()` côté serveur, `<script>` côté page (servi sur `/rules.js`). Les délais de relance, les statuts et la sélection ne sont écrits qu'une fois : l'interface ne peut pas afficher autre chose que ce que calcule le serveur.

Côté page, `public/app.js` n'est qu'un point d'assemblage : chaque écran (tableau, vue d'ensemble, sauvegardes, fiche candidature…) vit dans son module sous `public/js/`, reliés par des modules ES natifs. Aucun bundler, aucune étape de compilation : le serveur statique sert ces fichiers tels quels, et `npm test` recontrôle le graphe d'imports.

La couche serveur suit le même découpage, et `npm test` le contrôle aussi : un module par responsabilité (`errors` → `fields` → `model` → `sqlite` → `backups`/`cover`/`stats` → `store`/`import` → `export`/`pdf`), des dépendances qui ne remontent jamais d'une couche basse vers une couche haute, aucun cycle, et **une seule porte vers les règles** : un module qui a besoin d'une règle fait `require("./rules")`, jamais `require("./store")`. Le code HTTP, lui, n'existe que dans `server.js` : la couche de données lève des erreurs typées (`ValidationError`, `NotFoundError`, `BackupRefusedError`) et le transport les traduit en statuts.

Les dépendances du front ne vont que dans un sens : `state.js`, `render.js` et `ui.js` sont des feuilles, puis viennent `api.js` et `shell.js` (ossature : modales, menus, thème, focus), puis les écrans. Aucun module de couche basse n'importe un écran — le redessin des graphiques quand le thème change, par exemple, est passé à l'ossature par `app.js` sous forme de rappel, pas importé depuis `overview.js`. `npm test` vérifie ce sens, en plus des cycles et des imports nommés.

Le tableau de bord appartient à un seul module, `dashboard.js`. Son catalogue dit **quels widgets existent**, et le contenu de chacun est le `<template>` de `index.html` qui porte son id (`tpl-<id>`, `tpl-table`, `tpl-chart-monthly`…) : la convention s'écrit une fois, dans `buildCard`, et un test tient les deux bouts — chaque widget a son gabarit, chaque gabarit son widget. Un widget retiré n'est pas détruit — il est **détaché** du document, et le tableau Tabulator comme les graphiques gardent leurs nœuds et se reconstruisent à leur retour (`bindTableWidget`, `bindCharts`).

## Journal des changements

Voir [CHANGELOG.md](CHANGELOG.md).
