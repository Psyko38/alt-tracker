# Alt-Tracker — Suivi de Candidatures (Material Design 3.0)

Application web locale en **Node.js (Express + SQLite natif `node:sqlite`)** adoptant le système visuel **Google Material Design 3.0 (Material You)** pour suivre ses candidatures d'**alternance**, **emploi (CDI/CDD)**, **stage**, **freelance** et **autres opportunités**.

## ✨ Fonctionnalités

- **Design Google Material 3 (Material You)** :
  - **Navigation Rail** avec **Extended FAB** et bascule responsive en barre de navigation mobile.
  - **5 Palettes dynamiques Material You** (*Iris*, *Émeraude*, *Océan*, *Terracotta*, *Cerise*) + **Mode Clair / Sombre**.
- **5 Vues complémentaires** :
  1. **Tableau de bord** : KPIs en temps réel, taux de retour et d'entretien, relances urgentes, entretiens à venir, répartition par contrat et analyse de performance par version de CV.
  2. **Vue Kanban (Drag & Drop)** : Pipeline complet (*À postuler*, *Envoyée*, *Entretien RH*, *Test / Tech*, *Offre reçue*, *Refusée*).
  3. **Vue Liste / Tableau** : Tri multi-critères, changement de statut en ligne, favoris et accès direct aux annonces.
  4. **Agenda des Relances & Entretiens** : Bouton d'action rapide **« Marquer relancé (+7j) »** qui met à jour l'échéance et l'historique.
  5. **Bibliothèque CV & Lettres de motivation** : Stockage local des fichiers PDF/DOCX ou liens externes et suivi du taux de conversion par version de CV.
- **Panneau latéral (M3 Side Sheet)** : Fiche complète de chaque candidature avec coordonnées recruteur et **Timeline interactive** du journal de suivi.
- **Import / Export** : Export et import en 1 clic aux formats **CSV** (compatible Excel / Google Sheets / Notion) et **JSON**.

## 🚀 Démarrage rapide

### Prérequis
- **Node.js** `>= 22.5.0` (testé avec Node.js `v26.10.0`, utilise le module natif `node:sqlite`).

### Installation & Lancement

```bash
# Installer les dépendances
npm install

# Démarrer l'application (http://localhost:3000)
npm start

# Mode développement avec rechargement automatique
npm run dev

# Lancer les tests automatisés
npm test
```

## ⌨️ Raccourcis Clavier
- `N` : Ouvrir la fenêtre **Nouvelle candidature**
- `/` : Rechercher instantanément une entreprise, un poste, une ville ou un CV
- `Échap` : Fermer la modale ou le panneau latéral actif
