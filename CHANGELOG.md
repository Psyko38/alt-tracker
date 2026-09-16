# Journal des changements

## 2.14.1 — 2026-09-15

### Retiré

- **Le jeu de candidatures de démonstration.** Le bouton « Charger la
  démonstration » (état vide et modale d'import), le bandeau de rappel, la route
  `POST/DELETE /api/demo` et l'outil qu'elle décrivait dans le catalogue OpenAPI
  sont retirés. Le suivi démarre désormais toujours vide — les données d'exemple
  n'ont plus rien à faire à côté des vraies candidatures. Une sauvegarde JSON
  existante reste le chemin recommandé pour remplir un suivi neuf.

## 2.14.0 — 2026-09-15

### Ajouté

- **Le tableau de bord devient un plateau de widgets** : chaque bloc — les six
  indicateurs, mais chacun pour soi, les trois graphiques, le rendement de la
  recherche, la barre de recherche et filtres, la liste — est une carte qu'on
  **déplace**, qu'on **redimensionne** et qu'on **retire ou remet** à volonté. La
  page ne décide plus de l'ordre : elle propose ses widgets, et c'est la disposition
  enregistrée qui décide de ce qui s'affiche et dans quel ordre.

  Le déplacement se fait à la souris par la poignée de la carte (glisser-déposer
  HTML5, sans bibliothèque) **et** au clavier par deux boutons « déplacer vers la
  gauche / la droite » : l'ordre du document est l'ordre affiché, donc une carte
  déplacée l'est vraiment — pour les lecteurs d'écran comme pour le glisser-déposer
  suivant. La largeur se choisit dans la carte (1/6 à pleine largeur), et un
  graphique refuse de descendre plus bas que ce qu'il peut montrer (`min` par
  widget).

  Trois modes d'emploi, un seul endroit pour chacun : *Organiser* (et Échap) révèle
  les poignées, les largeurs et les croix de retrait, et gèle le contenu des cartes —
  sans quoi chaque déplacement cocherait un filtre ou ouvrirait une fiche ; le menu
  *Widgets* liste toutes les cartes disponibles, rangées par famille ; *Réinitialiser*
  (qui ne se propose que quand la disposition a bougé) repose celle d'origine.

  La disposition vit dans le navigateur (`jt-dashboard`), comme les colonnes du
  tableau, et rien de ce qu'elle contient n'est cru sur parole : une largeur inconnue
  ou sous le minimum reprend son défaut, un widget d'une autre version est oublié, un
  doublon est ignoré, et un widget **arrivé depuis** l'enregistrement est ajouté à la
  suite, affiché. Un widget retiré n'est pas détruit mais **détaché** du document : le
  tableau Tabulator et les graphiques gardent leurs nœuds et les retrouvent au retour —
  à eux de se construire ou de se redessiner, **depuis leur propre rendu**.

  La page ne déclare plus ses widgets : elle déclare leur **contenu**, une fois chacun
  (`<template id="tpl-…">`), et le plateau le trouve par convention (`tpl-<id>`, dérivé
  dans `buildCard`) — un test tient les deux bouts. Un seul endroit dit
  donc quels widgets existent et où chacun est construit, un seul mécanisme monte les
  cartes : la structure d'avant — dix cartes écrites dans le plateau et deux écrites à
  côté, reprises au démarrage par `insertBefore` — demandait de lire le JS pour savoir ce
  qui existait. Le plateau reste par ailleurs le **seul** à savoir ce qui est attaché, et
  il le dit (`watchWidget`) : chaque écran s'y abonne (voir app.js), au lieu de relire le
  document pour deviner si son conteneur est encore là.

  Ce point a coûté un aller-retour, et il vaut d'être écrit. La première version
  laissait le plateau appeler `initTable()` quand on remettait le widget de la liste :
  le tableau n'était donc construit que par ce chemin-là, et *Réinitialiser* — qui
  rattache la carte sans passer par le menu — rendait un conteneur vide sous un compteur
  qui annonçait des lignes (reproduit sur la page : `rows: 0`, « 1 candidature affichée
  sur 1 »). La construction est maintenant tirée par `renderTable` lui-même, à chaque
  rendu, et **les lignes partent avec le constructeur** (`data`) et non par un `setData`
  juste après : Tabulator bâtit son DOM de façon asynchrone, et un `setData` dans la
  même passe lève (`Cannot read properties of null (reading 'verticalFillMode')`) tout en
  laissant les lignes marquées comme envoyées — l'écran ne se repeignait plus jamais.
  Côté graphiques, `refreshDashboard` fait déjà ce travail : les cartes annoncées
  attachées entrent dans la clé du dessin, et un graphique dont la carte a quitté la page
  est détruit pour être redessiné à son retour (vérifié : retrait → rechargement →
  *Réinitialiser* → canevas 657×246, `Chart.getChart` de nouveau vivant).

  Le montage a son propre piège, trouvé dans la page à la première vérification : un
  widget retiré au chargement n'est pas dans le document, donc les éléments qu'il contient
  (la recherche, le tableau, les canevas) échappent au registre (`cacheElements`) —
  *Réinitialiser* les faisait alors revenir sous des nœuds que personne n'avait en cache
  (`Cannot read properties of null (reading 'classList')` dans `renderTable` et à la fin de
  `load`). Le plateau monte donc **tous** les widgets au démarrage, remplit le registre
  lui-même, puis applique la disposition enregistrée — qui détache les retirés ; les trois
  étapes tiennent dans la même passe, donc rien ne se voit.

- `public/js/dashboard.js` : le catalogue des widgets, la disposition (lecture,
  écriture, réordonnancement) et le plateau. Les fonctions de disposition sont pures
  (`parseLayout`, `orderItems`, `applyOrder`) : `test/dashboard-layout.test.js` les
  relit comme le fait le démarrage — c'est `applyOrder` qui décide de l'ordre
  enregistré à chaque survol, et une erreur d'index y produirait une disposition qu'on
  ne pourrait plus ranger autrement qu'en la réinitialisant. `test/dashboard-lifecycle.test.js`
  monte le plateau hors navigateur (DOM minimal, comme `table-render.test.js` pour
  Tabulator) et écoute ce qui est annoncé : retirer ou remettre une carte une seule fois,
  un réordonnancement qui n'annonce **rien**, le plateau vidé dont chaque sortie est
  annoncée, et un widget sans gabarit — sans carte, donc jamais annoncé attaché.

### Modifié

- `overview.js` déclare les indicateurs (`STAT_CARDS`) et n'en dessine plus une
  grille unique : chacun écrit dans son propre conteneur (`#stat-total`,
  `#stat-sent`…), et un indicateur retiré n'a simplement plus de conteneur.
  `bindOverview` écoute les clics sur le plateau, qui ne recrée jamais ses cartes.
- `dashboard.js` expose `watchWidget` : le contrat de vie d'un widget — le plateau
  annonce ce qu'il attache et ce qu'il détache, et un écran s'y abonne plutôt que de
  relire le document. `table.js` (`bindTableWidget`) et `overview.js` (`bindCharts`)
  s'abonnent ainsi à leur propre carte ; `app.js` fait le lien, comme pour le thème.
  `ui.js` n'expose plus `isAttached`, qui n'a plus d'employeur.
- `index.html` ne contient plus aucune carte : un `<template>` par widget porte son
  contenu, et le plateau les clone au démarrage (`tpl-stat-total`, `tpl-filters`…).
- Le bandeau de relances et le rappel du jeu de démonstration restent hors du plateau,
  en tête de page : ce sont des états de la liste, pas des cartes à ranger, et ils ne
  doivent pas disparaître avec un widget.
- L'entonnoir du rendement suit la largeur que l'utilisateur donne à sa carte
  (`auto-fit` à partir de 128 px) au lieu de quatre colonnes fixes.

## 2.13.2 — 2026-09-15

### Corrigé

- **Le garde-fou « les règles n'ont qu'une porte » ne voyait que la
  réexportation, pas la recopie.** Une copie de la valeur d'une règle sous un autre
  nom (`{ statuts: [...rules.STATUSES] }`) laissait le test vert — et ce n'était pas
  une hypothèse : `lib/fields.js` redérivait `DATE_FIELDS` depuis le schéma, une
  seconde définition qui devait rester d'accord avec celle des règles. Le détecteur
  compare maintenant aussi la **forme** des valeurs exportées (même contenu
  sérialisé), donc toute recopie — tableau, objet, scalaire membre, copie profonde —
  fait échouer `npm test`, quelle que soit la mise en forme du `module.exports`.
  Vérifié en réintroduisant chaque forme sur l'arbre réel : la recopie historique
  dans `fields.js` et une recopie sous un autre nom dans `stats.js` passent toutes
  deux au rouge.

  La seule recopie réelle qu'il a trouvée a été supprimée plutôt que tolérée :
  `lib/fields.js` ne redéfinit plus `DATE_FIELDS`, et ses consommateurs
  (`lib/model.js`, `lib/store.js`) le prennent chez les règles avec
  `require("./rules")` — la valeur vient d'une seule définition au lieu de deux.
  Comme le schéma marque encore ses champs `type: "date"` (c'est sa documentation),
  un test vérifie que les deux listes disent exactement la même chose : sans quoi un
  champ daté du schéma cesserait d'être normalisé en silence.

  Ce qui reste hors de portée est nommé, pas sous-entendu. D'une part un **élément**
  de règle recopié seul (`"Postulé"`, une valeur de `STATUSES`) n'est pas un membre
  à part entière et échappe à la comparaison — le chercher dans tout le texte ferait
  crier le test sur chaque libellé qui ressemble à un statut. D'autre part un **accès
  calculé** (`rules["STAT" + "USES"]`) n'est pas vu par la lecture de source, et le
  voir demanderait d'instrumenter le `require` (un Proxy sur le module des règles),
  disproportionné pour ce qu'il protégerait : un accès calculé ne peut lire que
  `require("./rules")` — aucun autre module n'expose les règles — et la seule façon
  d'en faire une porte, la réexporter, est vue. Un accès calculé *exporté*, lui, est
  bien attrapé (vérifié : `rules["STAT" + "USES"]` sous une clé `cle` fait échouer
  le test). Les deux limites sont écrites en tête de `test/lib-layers.test.js`.

### Ajouté

- Trois formes de **recopie** dans le contrôle du contrôle (recopie de tableau, de
  objet, copie profonde), et un test qui verrouille l'accord entre les champs
  `type: "date"` du schéma et `rules.DATE_FIELDS`.

## 2.13.1 — 2026-09-15

### Corrigé

- **Le garde-fou « les règles n'ont qu'une porte » ne tenait sa promesse qu'à
  moitié.** L'assertion de réexport lisait la SOURCE et ne reconnaissait qu'une mise
  en page : `module.exports = { … }` sur plusieurs lignes — la forme qu'avait
  `store.js` avant la refonte de 2.13.0. Le même objet écrit sur une seule ligne, un
  spread (`{ ...rules }`), un réexport renommé (`{ statuts: rules.STATUSES }`),
  `exports.STATUSES = rules.STATUSES` ou le module entier (`{ rules }`) passaient
  tous au vert, alors que la règle était bel et bien joignable par ce module. Un test
  qui passe sur la forme et pas sur le fond vaut moins que pas de test : il fait
  croire à une garantie. Mesuré sur une copie conforme de `lib/`, un module à la
  fois : l'ancien contrôle voyait 1 forme sur 6, le nouveau les 6.

  Le contrôle compare maintenant les VALEURS réellement exportées : une clé dont la
  valeur est (par référence) le module des règles ou l'un de ses membres fait
  échouer le test, quelle que soit la mise en forme. Deux contrôles l'accompagnent
  dans le même test : les six formes sont rejouées en mémoire (sinon un détecteur
  affaibli resterait vert tant que personne ne faute), et un module qui se sert d'une
  règle sans la réexposer doit rester vert.

  Ce qui reste hors de portée est écrit dans le fichier plutôt que sous-entendu :
  recopier la *valeur* d'une règle sous un autre nom (`{ statuts: [...rules.STATUSES] }`),
  un accès calculé (`rules[nom]`) et un `require` qui sort de `lib/` ou construit son
  chemin ne sont pas vus. Le test nomme donc ses trois limites en tête de fichier.
- **Le journal de 2.13.0 promettait plus que le test n'en faisait** : il annonçait
  qu'« une réexportation » faisait échouer le test sans distinguer la forme. Corrigé
  dans l'entrée 2.13.0 elle-même, pour que la promesse corresponde à ce que la
  version livrait.

### Ajouté

- Un contrôle de non-régression sur le détecteur lui-même : les six formes de
  réexport sont vérifiées à chaque exécution du test.

## 2.13.0 — 2026-09-15

### Modifié

- **La couche de données est découpée comme la page l'avait été : un module par
  responsabilité.** `lib/store.js` faisait 966 lignes et portait six métiers —
  schéma et migrations, validation et normalisation, CRUD SQLite, page de garde,
  orchestration des instantanés, import, statistiques — et construisait en plus des
  erreurs en forme de réponse HTTP (`statusCode`, `expose`), donc la couche de
  données connaissait le protocole de son appelant. Il est maintenant :
  `lib/errors.js` (erreurs métier typées), `lib/fields.js` (schéma des champs),
  `lib/model.js` (normalisation + validation), `lib/sqlite.js` (fichier, connexion,
  schéma, lecture/écriture des lignes), `lib/backups.js` (instantanés),
  `lib/cover.js` (page de garde), `lib/stats.js` (statistiques et tableau de bord),
  `lib/import.js` (import), et `lib/store.js` réduit aux opérations sur les
  candidatures (230 lignes). Aucun comportement ne change : mêmes routes, mêmes
  statuts HTTP, mêmes messages, mêmes fichiers, même format de sauvegarde.

  La connexion a dû devenir une feuille à part entière : sans `lib/sqlite.js`,
  `deleteApplication` (qui prend un instantané avant de supprimer) et
  `restoreSnapshot` (qui ferme puis rouvre la base) se seraient importés l'un
  l'autre. Les dépendances ne vont plus que dans un sens :
  `errors`/`fields`/`rules` → `model` → `sqlite` → `backups`/`cover`/`stats` →
  `store`/`import` → `export`/`pdf`.

- **Les règles n'ont plus qu'une porte.** `store.js` réexportait 24 membres de
  `lib/rules.js` ; `lib/pdf.js` et `lib/export.js` consommaient les règles par ce
  biais. Chaque consommateur fait désormais `require("./rules")` : déplacer une
  règle ne demande qu'un fichier. Plus rien dans `lib/` ne réexporte une règle.

- **Le code HTTP vit dans le transport.** `server.js` traduit les erreurs typées
  (`ValidationError` → 400, `NotFoundError` → 404, `BackupRefusedError` → 500, avec
  le message affiché) au lieu de lire `statusCode`/`expose` posés par la couche de
  données. Les refus restent explicites : « Sauvegarde de sécurité impossible
  (avant une suppression) : … droits d'écriture », et rien n'est supprimé.

### Ajouté

- **Un test verrouille la structure de la couche serveur** (test/lib-layers.test.js) :
  chaque module appartient à une couche déclarée, une dépendance ne remonte jamais
  d'une couche basse vers une couche haute, le graphe est acyclique, `pdf.js` et
  `export.js` n'importent plus le store, et aucun fichier de `lib/` ne pose de
  `statusCode`. Réintroduire une règle dupliquée dans `lib/`, une réexportation **de
  la forme alors écrite** (`module.exports = { … }` sur plusieurs lignes, comme le
  faisait `store.js`) ou un import montant le fait échouer — vérifié en les
  réintroduisant. Ce contrôle de réexport ne lisait que la source, donc que cette mise
  en page : il est remplacé en 2.13.1 par un contrôle sur les exports réels.
- Le balayage des règles de relance (test/export.test.js) ne lit plus seulement
  `lib/store.js`, mais tous les modules de `lib/` : le test n'aurait plus rien
  prouvé dès lors que le store ne contenait plus la logique.

## 2.12.0 — 2026-09-15

### Corrigé

- **Le tableau restait vide en sortant de l'état vide.** Première candidature d'un
  suivi vierge, démonstration chargée depuis le panneau vide, import, restauration
  d'un instantané, réinitialisation des filtres après une recherche sans résultat :
  les lignes existaient, le compteur les annonçait, et l'écran n'en montrait aucune.

  La cause précède de plusieurs versions le garde-fou introduit en 2.11.0 :
  `renderTable()` rafraîchissait le tableau **avant** de réafficher son conteneur.
  `setData` ne peint rien dans un tableau sans dimensions — masqué par
  `display: none`, `#applications-table` mesure 0 px de haut — et réafficher le
  conteneur ensuite ne redessine pas les lignes (mesuré : 0 ligne peinte, hauteur
  0 px au moment du rafraîchissement, 80 px juste après sans qu'aucune ligne
  n'apparaisse ; `redraw()` les fait apparaître). Le garde-fou de 2.11.0 n'était donc
  pas la cause, mais il rendait le défaut **définitif** : il supprimait la seconde
  chance qu'offrait l'ancien `setData` inconditionnel, qui repeignait au rendu
  suivant (vérifié sur les deux versions).

  Le correctif déplace d'une ligne : la visibilité du conteneur est posée avant le
  rafraîchissement, jamais après. `renderTable()` est le seul écrivain de cette
  visibilité, donc le rafraîchissement trouve toujours le conteneur dans son état
  définitif. Le gain de 2.11.0 est intact : basculer une colonne qui n'entre pas
  dans le contenu des cellules ne rappelle toujours pas `setData` (0 appel), tandis
  que « Notes » (repère dans la cellule « Entreprise »), une carte rapide ou une
  pastille rafraîchissent toujours.

### Ajouté

- **Un test verrouille la sortie de l'état vide** (`test/table-render.test.js`) :
  avec un conteneur masqué, la première ligne doit être **peinte**, pas seulement
  chargée, et le compteur doit dire la même chose que l'écran. Il échoue si la
  bascule du conteneur repasse après le rafraîchissement.

## 2.11.0 — 2026-09-15

### Modifié

- **Le tableau n'est plus reconstruit quand rien de ce qu'il affiche n'a changé.**
  `setData()` refait tout le tableau : mesuré sur la page, ~40 ms sur les ~41 ms
  d'un rendu, avec 563 relectures de la mise en page (`offsetHeight`) pour 12
  lignes. Or plusieurs rendus ne changent aucune ligne : basculer une colonne qui
  n'entre pas dans le contenu des cellules, recharger un jeu identique, taper une
  lettre qui ne réduit pas la sélection (mesuré : 3 des 4 rendus d'un mot de 4
  caractères). Ces rendus coûtaient 40 ms pour rien — et, `setData` repassant la
  pagination à la page 1, ils ramenaient aussi le tableau à la première page.
  L'interface ne se redessine que si la clé change : contenu exact des lignes
  affichées, visibilité de la colonne « Notes » (masquée, elle ajoute un repère dans
  la cellule « Entreprise ») et jour courant (`il y a 3 j` et l'état de relance sont
  calculés à l'affichage). Un rendu inchangé passe de ~41 ms à ~6 ms (bascule d'une
  colonne : 46,3 ms avant, 6,2 ms après) et le tableau ne saute plus à la page 1.
  Rien ne change à l'écran : mêmes lignes, même ordre, mêmes compteurs, mêmes
  paramètres d'export, même trafic API.

### Ajouté

- **Un test verrouille ce comportement** (`test/table-render.test.js`) : mêmes
  lignes ⇒ pas d'appel à `setData` ; ligne modifiée, sélection réduite, colonne
  « Notes » basculée ⇒ appel. Il échoue si `setData` redevient inconditionnel.

## 2.10.0 — 2026-09-15

### Modifié

- **Les dépendances du front-end ne remontent plus jamais d'une couche basse vers
  un écran.** `public/js/shell.js` — l'ossature que tous les autres modules
  importent — importait `refreshDashboard` depuis `overview.js` pour redessiner les
  graphiques au changement de thème : toucher à la façon dont les graphiques se
  dessinent forçait donc une modification du fichier dont tout le monde dépend.
  Le sens est inversé : `shell.js` n'importe plus que les feuilles (`state.js`,
  `ui.js`) et c'est `app.js`, qui connaît les deux côtés, qui lui passe le rappel
  (`bindShell({ onThemeChange: refreshDashboard })`). Comportement inchangé : le
  bouton bascule le thème, le mémorise, échange son icône et laisse les graphiques
  redessinés et lisibles dans le nouveau thème.
- **Le sens des dépendances est recontrôlé par les tests.** Une assertion par
  module vérifie qu'aucun import ne remonte d'une couche basse vers une couche
  supérieure (`state`/`render`/`ui`, puis `api`/`shell`, puis les écrans), plus une
  assertion nommée sur l'arête corrigée ici : la réintroduire fait échouer
  `npm test`.

### Corrigé

- **Le test « le store et l'interface ne redéfinissent plus les règles de relance »
  garde maintenant ce qu'il annonce.** Il ne lisait plus que `public/app.js`, qui
  ne contient plus aucune logique d'écran depuis le découpage : un module pouvait
  recopier `FOLLOWUP_DELAYS` ou `followUpState` sans que le test bronche. Il balaie
  désormais tout le JavaScript servi (`public/app.js`, les modules `public/js/*.js`
  et le script en ligne de `public/index.html`), vérifie que `lib/rules.js` est bien
  le seul endroit qui les définit — quelle que soit la forme (`const`, `let`,
  `var`, `function`, `class`, avec ou sans `export`) — et qu'au moins un module les
  lit vraiment depuis `Rules`, pour que le balayage ne soit pas vide pour la
  mauvaise raison.

## 2.9.0 — 2026-09-15

### Modifié

- **Toutes les boîtes de dialogue ont le même contrat clavier.** Tab et Maj+Tab
  tournent à l'intérieur de la modale ouverte, Échap la ferme, un clic sur le fond
  aussi, et le focus revient à l'élément qui l'a ouverte. La règle est écrite une
  seule fois (`bindDialog` dans `public/js/shell.js`) et chaque modale l'appelle
  avec sa propre fonction de fermeture : les sauvegardes, qui n'avaient jamais reçu
  le piège de focus, l'ont maintenant comme les autres. Une modale ouverte depuis le
  menu « Exporter » rend le focus au bouton du menu — l'entrée cliquée, elle, a
  disparu avec le menu. Les deux menus déroulants suivent la même règle pour ce qui
  les concerne : Échap les ferme et rend le focus à leur bouton.
- **Les graphiques ne sont plus redessinés à chaque rendu.** Ils n'étaient
  reconstruits que pour être à nouveau détruits à chaque frappe dans la recherche ou
  chaque changement de filtre, alors que ni la réponse du serveur ni le thème
  n'avaient bougé. Mesuré sur la page : 46 ms par rendu avec, 36 ms sans (suite
  alternée, sd 0,4–3,4 ms) — soit ~10 ms payés pour rien. Ils sont maintenant
  redessinés quand la réponse change (chargement, édition en ligne, import,
  restauration) ou quand le thème change, et pas autrement.

## 2.8.0 — 2026-09-15

### Modifié

- **L'interface quitte le script unique.** `public/app.js` faisait près de 2000 lignes et
  portait à lui seul le tableau, la vue d'ensemble, les modales, les formulaires, les
  notifications, le thème et les raccourcis. Il ne garde plus que son rôle
  d'assemblage — charger les préférences, brancher les écouteurs de chaque écran,
  orchestrer le rendu et les raccourcis clavier globaux — et chaque écran vit
  maintenant dans son module sous `public/js/` : `table.js` (Tabulator et édition en
  ligne), `overview.js` (cartes, entonnoir, graphiques), `backups.js` (instantanés),
  `entries.js` (fiche candidature), `transfer.js` (import/exports), `columns.js`,
  `filters.js`, `cover.js`, `demo.js`, `shell.js` (modales, menus, thème, focus),
  `ui.js` (primitives d'affichage), `api.js` (REST), `state.js` (état partagé) et
  `render.js` (déclencheur de rendu unique). Une évolution du tableau, de la vue
  d'ensemble ou des sauvegardes ne touche plus qu'un fichier.
- **Modules ES natifs, sans outil de compilation.** `index.html` charge `app.js` en
  `type="module"` ; le serveur statique sert les fichiers tels quels. Un test
  (`test/public-modules.test.js`) recontrôle le graphe d'imports : chaque nom importé
  doit exister chez le module qui l'exporte, et le point d'entrée ne doit pas se
  remettre à dessiner les écrans lui-même.

### Retiré

- Le tableau écrit à la main qu'`app.js` gardait en commentaire depuis le passage à
  Tabulator, et les aides `INLINE_HINTS` / `fieldLabel` qu'il portait sans plus aucun
  appelant.

## 2.7.0 — 2026-09-15

### Ajouté

- **Les instantanés de la base pour les agents.** Trois outils MCP de plus —
  `list_backups`, `create_backup`, `restore_backup` — donnent à un agent le même filet
  qu'à l'interface : il peut lister les instantanés, en créer un avant une manipulation
  risquée, et revenir en arrière. `get_schema` et `GET /api/schema` décrivent désormais
  aussi les analyses (`insights`) et les sauvegardes, avec les définitions employées.
- **Ce que contient une sauvegarde, avant de la restaurer.** `GET /api/backups` (et le
  listing MCP) annoncent pour chaque instantané sa date à la seconde, sa taille et son
  nombre de candidatures ; la confirmation de restauration parle en français
  (« le 15/09/2026 à 09:57:54, 12 candidatures ») au lieu d'un nom de fichier.

### Modifié

- **Un mot, un chiffre.** « Envoyée », « réponse » et « entretien » ne sont plus définis
  trois fois : `lib/rules.js` les fixe une seule fois et la carte de statistiques, le
  filtre rapide, l'entonnoir, les exports et l'API les lisent. La carte « Envoyées »
  annonce donc exactement la première marche de l'entonnoir (l'historique compte : une
  fiche remise « À postuler » par un import reste comptée), le filtre rapide montre
  exactement les lignes comptées, et « Entretiens en cours » (statut actuel) ne se
  confond plus avec « Entretiens obtenus » (étapes atteintes). Le taux de réponse
  porte sur ces derniers, avec ses deux nombres affichés.
- **Tous les chiffres de la vue d'ensemble viennent du serveur, et ils sont redemandés
  après chaque écriture.** Les cartes de statistiques et la carte d'analyses étaient
  recalculées dans la page pendant que les graphiques venaient de `/api/dashboard` :
  jusqu'à trois chemins pour les mêmes totaux. Bandeau, graphiques et analyses affichent
  désormais la réponse du serveur — un seul instantané — et une modification en ligne
  (statut, notes…) le rafraîchit. Une relance qui échoue ne vide plus l'écran et ne
  remplace plus rien : le dernier état connu reste affiché **en entier**, au lieu de
  laisser les cartes bouger pendant que les analyses restent figées.
- **Le mécanisme des instantanés quitte `lib/store.js`.** Copie datée, rotation et
  contrôle d'intégrité vivent dans `lib/snapshots.js` ; l'écriture de fichiers
  tout-ou-rien (`tmp` + `rename`) est écrite une seule fois dans `lib/files.js`, utilisée
  par les exports comme par les sauvegardes. `store.js` ne garde que ce qui a besoin
  de la base ouverte.

### Corrigé

- **Lire les sauvegardes n'écrit plus dedans.** Compter les fiches d'un instantané (et
  vérifier qu'il est lisible avant de le restaurer) ouvrait la copie sur place ; sqlite
  crée alors un `-wal` et un `-shm` à côté d'une base en mode WAL, même en lecture seule.
  Chaque listing déposait donc deux fichiers morts dans `data/backups/`, que la rotation
  ne supprimait jamais (`data/` en récoltait deux autres à chaque restauration). Les
  contrôles se font maintenant sur une copie jetable, dans le dossier temporaire du
  système : les dossiers de données ne contiennent plus que ce qu'on y a mis.
- **Une restauration refusée ne laisse plus un double de la base derrière elle.** Si
  l'instantané de sécurité ne pouvait pas être écrit, la copie de travail préparée juste
  avant restait à côté de la base. Elle est désormais remballée quelle que soit l'issue,
  et le refus n'a plus rien à rattraper puisqu'il intervient avant toute écriture.
- **Les infobulles d'en-tête du tableau fonctionnent enfin.** L'option passée s'appelait
  `titleTooltip` : Tabulator ne la connaît pas, la rejetait à chaque construction du
  tableau (17 avertissements en console) et n'affichait aucune infobulle. Elle s'appelle
  `headerTooltip`.
- **Une suppression qui n'était pas la seule victime.** Si l'instantané de sécurité
  ne pouvait pas être écrit (dossier en lecture seule, disque plein), la suppression
  échouait en « Erreur interne du serveur » et l'utilisateur ne pouvait plus rien
  supprimer sans savoir pourquoi. L'opération est toujours refusée — mais elle explique
  maintenant le motif (`Sauvegarde de sécurité impossible (avant une suppression) : …`)
  et le serveur transmet les messages qu'il a produits lui-même, même en 500.
- **Le nom des canaux n'est plus coupé.** Dans la carte d'analyses, la colonne du
  libellé cédait la place à la barre de pourcentage : « Bouche à oreille » s'affichait
  « Bouche à or… » à largeur moyenne. Le libellé passe avant sa barre (et garde son
  texte complet en infobulle pour les cas extrêmes).

## 2.6.0 — 2026-09-14

### Ajouté

- **Rendement de la recherche.** Un bloc d'analyses dans le tableau de bord, alimenté par
  une règle partagée (`computeInsights`) : entonnoir des étapes (envoyées → réponses →
  entretiens → offres), délai moyen avant la première réponse, et rendement par canal
  (LinkedIn, HelloWork…) avec le taux de réponse de chacun. Tout est déduit du statut et de
  l'historique horodaté — rien de plus à saisir — et l'historique compte : un entretien suivi
  d'un refus reste dans l'entonnoir. Les mêmes chiffres sortent de `GET /api/dashboard`.
- **Filet de sécurité sur les données.** La base est copiée dans `data/backups/` à chaque
  démarrage (et seulement si elle a bougé, sinon dix redémarrages effaceraient l'historique)
  et juste avant toute opération destructrice : suppression d'une fiche, suppression en
  masse, import en remplacement. Les 10 instantanés les plus récents sont conservés.
- **Sauvegardes listables et restaurables.** *Exporter → Sauvegardes* (ou `GET /api/backups`,
  `POST /api/backups`, `POST /api/backups/restore`) liste les instantanés avec leur date et
  leur taille, en crée un à la demande et restaure celui que l'on choisit. L'état écrasé est
  copié avant d'écraser : une restauration se défait donc aussi.

### Modifié

- Les copies « avant-remplacement » écrites à côté de la base font place au même mécanisme
  d'instantanés horodatés, réunis dans `data/backups/` : un seul endroit à regarder pour
  savoir ce qui est récupérable.

## 2.5.0 — 2026-09-14

### Modifié

- **Nouvelle identité visuelle, chaleureuse et minimaliste.** Le jeu de couleurs passe
  d'un bleu-indigo froid à une palette chaude : fond crème `#f7f3ec` (jamais blanc pur),
  cartes ivoire `#fffcf7`, filets de sable, accent terracotta `#b1552c` et texte brun-gris
  profond `#2e2a24` (jamais noir). Le thème sombre suit la même logique (bruns profonds et
  accent ambré) au lieu d'un bleu nuit.
- **Tout part des jetons CSS.** Couleurs, rayons, ombres et séries de graphiques sont
  déclarés une seule fois en tête de `style.css`. Chart.js lit désormais `--chart-*` et les
  couleurs de texte du thème en cours : un changement de thème redessine les graphiques
  au lieu de garder les teintes de l'autre thème.
- **Icônes SVG à la place des emoji.** Un sprite embarqué (32 icônes, grille de 24 px,
  trait de 1,6 px) remplace tous les pictogrammes emoji de la barre d'actions, des cartes
  de statistiques, des menus, du tableau et des notifications. Le rendu ne dépend plus de
  la police emoji du système et la couleur suit le contexte (`currentColor`).
- **Style aplati** : plus aucun dégradé (le chargement « squelette » respire par opacité) ni
  effet de flou (`backdrop-filter` retiré de la barre d'application et des modales).
  Cartes à filet fin, ombres teintées à la limite du perceptible, rayons resserrés
  (14 px pour les cartes, 8 px pour les contrôles) et boutons ramenés à trois niveaux.
- **Signal « à relancer » ramené à l'essentiel.** La ligne garde la même surface que les
  autres : ce sont le filet d'accent de 3 px à gauche et la pastille d'ancienneté (`+22 j`)
  qui portent l'information. La teinte pleine sur toute la ligne faisait un troisième repère
  pour la même chose et cassait le rythme du tableau ; elle n'apparaît plus qu'au survol.
  Le filet est posé sur la **ligne** (pseudo-élément en `absolute`, de haut en bas) et non
  sur sa première cellule : les colonnes « Notes » et « Contact » sont en hauteur variable,
  donc la ligne est plus haute que sa première cellule et le filet s'arrêtait au milieu.
- **L'export PDF suit la même identité.** Sa palette reprenait les bleus-indigo de
  l'ancien thème : elle est recopiée depuis les jetons du thème clair de `style.css`
  (fond de page crème `--bg`, lignes ivoire `--card`, bandeau d'en-tête sable `--bg-elev`,
  accent terracotta, tons de statut chauds). Le zébrage des lignes disparaît au profit
  d'une surface ivoire unique et des filets de sable, comme le tableau de l'interface.
- **Hiérarchie retravaillée** : micro-libellés en capitales, chiffres en chiffres tabulaires,
  espacements élargis, pastilles de statut en petits blocs arrondis (et non plus en bulles),
  colonne « Entreprise » mise en avant dans le tableau.

### Corrigé

- **Les fichiers statiques ne se mettaient jamais à jour tout seuls.** Le serveur les
  envoyait sans en-tête de cache : le navigateur appliquait sa propre péremption et pouvait
  servir un `style.css` périmé après une modification — on débogue du CSS qui n'est plus sur
  le disque. Ils sont maintenant servis avec `Cache-Control: no-cache` + `ETag` : revalidés
  à chaque chargement, avec un `304` quand rien n'a bougé.
- **Lignes de relance délavées (voire claires) dans le tableau sombre.** Le fond des lignes
  en relance était une teinte translucide : sa couleur finale dépendait donc de ce qu'il y
  avait derrière, et le moteur de tableau peint un blanc (`#fff`) sous les lignes. Une ligne
  en relance ressortait claire dans un tableau sombre. Les surfaces sombres sont désormais
  **opaques**, et le tableau peint explicitement tous ses fonds (`tableholder`, `table`,
  lignes, lignes paires) avec les jetons de l'application : plus aucun blanc du moteur ne
  peut transparaître. Le thème sombre est aussi relevé d'un cran (fond `#1a1613`, cartes
  `#241f19`) pour que le tableau ne se lise plus comme un bloc noir.
- Sur mobile, les libellés de boutons ne disparaissent plus que dans la barre d'application :
  le bouton d'action de l'état vide (et ceux des modales) restent lisibles.

## 2.4.0 — 2026-09-13

### Ajouté

- SQLite devient l'unique stockage applicatif via `better-sqlite3` (`data/applications.sqlite`). Les CRUD, imports, page de garde et statistiques utilisent des transactions SQLite ; aucun JSON n'est lu ou écrit en arrière-plan.
- Migration explicite et à sens unique avec `node scripts/migrate-json.js <applications.json> [cover.json]`.
- Dashboard Chart.js : évolution mensuelle sur 12 mois et répartitions par statut et type, alimentées par `/api/dashboard`.

### Modifié

- Les sauvegardes JSON restent disponibles comme format d'export/import volontaire, mais ne constituent plus un fichier de données local.

## 2.3.0 — 2026-09-12

### Ajouté

- **Filtre par plage de dates** : deux bornes « du … au … » dans la barre d'outils, sur la
  **date de démarche** (défaut) ou la **relance prévue** (`dateField=nextAction`).
  - **Bornes incluses** : « du 1er au 7 » retient le 7, comme un calendrier.
  - Une seule borne suffit (« à partir du », « jusqu'au »).
  - Une fiche **sans date** sur le champ filtré sort de la sélection : mieux vaut l'exclure
    que l'inclure sans pouvoir la situer.
  - Une borne incohérente est ignorée (`2026-13-45`, `31/02`) au lieu de vider la liste
    sans explication ; un début postérieur à la fin donne simplement zéro résultat, avec le
    message et le bouton « Réinitialiser les filtres » déjà en place.
- Le filtre suit le reste : **exports CSV/PDF** (`?from=…&to=…`), **API** et **MCP**
  (`list_applications`, `export_csv`, `export_pdf`). L'en-tête du PDF, le titre de la liste
  et le nom du fichier reprennent la plage (« du 01/09/2026 au 12/09/2026 » →
  `candidatures-2026-09-12-du-01-09-2026-au-12-09-2026.pdf`).

### Corrigé

- **Filet de séparation interrompu sous la colonne « Actions »** : la cellule contenait
  `display: flex`, ce qui la sortait du tableau — elle ne remplissait plus la hauteur de la
  ligne (31 px manquants) et son propre filet se dessinait au milieu du tableau, laissant un
  trou visible dans le séparateur de chaque ligne. La cellule redevient une vraie cellule de
  tableau (alignement par le texte, boutons en ligne) ; le flex reste réservé à la vue
  « cartes », où les cellules ne sont plus des cellules de tableau.

### Modifié

- `normalizeDay()` remplace l'extraction naïve de date : elle refuse les dates impossibles,
  en lisant aussi bien `2026-09-12` qu'un horodatage ISO complet.

## 2.2.0 — 2026-09-12

### Ajouté

- **Export de la sélection** : les exports **CSV** et **PDF** suivent ce qui est affiché —
  filtre de statut, type de contrat, recherche libre, « à relancer » et tri en cours. Filtrer
  sur « À postuler » n'exporte donc que les « À postuler » (interface et API :
  `?status=…&quick=…&q=…`).
  - Le menu **Exporter** indique combien de lignes partiront (« 3 sur 10 ») et rappelle
    que le JSON, lui, reste complet.
  - Le nom du fichier porte le filtre (`candidatures-2026-09-12-postule.csv`) : deux
    exports du même jour ne s'écrasent plus dans le dossier de téléchargement.
  - L'en-tête du PDF rappelle la sélection et **ses indicateurs** (sinon « 3 candidatures »
    à côté d'un suivi de 10 ressemblerait à une perte de données).
  - Les outils MCP `export_csv` et `export_pdf` acceptent les mêmes filtres ;
    `export_applications` (JSON) reste volontairement **non filtrable** : une sauvegarde
    partielle ne doit pas pouvoir écraser le reste à la restauration.
- **Sélection partagée** (`lib/rules.js`) : filtres, recherche libre, filtres rapides,
  tri et statistiques sont écrits **une seule fois**, utilisés par l'interface, l'API,
  les exports et le serveur MCP. « Exporter ce que je vois » n'est plus une promesse :
  c'est le même code qui tourne des deux côtés. `store.listApplications` et
  `store.getStats` s'y appuient aussi, donc l'API gagne au passage les filtres
  `followup` et `quick`, et la recherche libre couvre les mêmes champs que l'écran.

### Modifié

- `store.getStats()` accepte une liste en argument : les statistiques d'un export
  filtré portent sur la sélection.

## 2.1.0 — 2026-09-12

### Ajouté

- **Colonne « Téléphone » dans le PDF**, entre `CONTACT` et `EMAIL`, dans le même
  format que la colonne Contact de l'interface (même police, même couleur, aligné à
  gauche). Le PDF suit donc l'ordre nom → téléphone → e-mail.
- **Colonne « Téléphone » affichée par défaut** dans le tableau de l'interface
  (elle existait mais restait masquée).
- **`lib/export.js`** : exports partagés par le serveur HTTP et le serveur MCP
  (CSV Excel, sauvegarde JSON, écriture des fichiers d'export). Une sauvegarde faite
  via MCP se restaure via REST, et inversement.
- **`lib/rules.js`** : module « dual » (un seul fichier, `require()` côté serveur,
  `<script>` côté page). Les statuts, les tons, les dates et les règles de relance
  n'existent plus qu'à un endroit.
- **Six outils MCP supplémentaires** (15 au total, à parité avec l'API REST) :
  `get_schema`, `set_status`, `export_applications`, `export_csv`, `export_pdf`,
  `import_applications`. Les exports écrivent un fichier et renvoient son chemin.
- **Page de garde transportée par les exports** : la sauvegarde JSON embarque
  `cover` et l'import la restaure dans les deux modes (fusion et remplacement).
  Le format de sauvegarde passe en `exportVersion: 2` (une sauvegarde sans `cover`
  laisse la page de garde existante intacte).
- **Jeu de démonstration** chargeable et retirable en un clic (`POST`/`DELETE /api/demo`).
- **Suite de tests** (`npm test`, `node --test`) : store, migrations, relances,
  exports, PDF, serveur HTTP et serveur MCP piloté en stdio. 58 tests, aucune
  dépendance, données isolées dans un dossier temporaire.

### Corrigé

- **E-mails coupés dans le PDF** : les largeurs de colonnes étaient figées (Email à
  88 pt), tout dépassement partait en « … ». Elles sont désormais calculées d'après
  le contenu réel de chaque colonne ; une valeur exceptionnellement longue passe sur
  deux lignes, et seules les colonnes réellement saturées cèdent un peu.
- **Numéro de téléphone invisible** : beaucoup de fiches avaient le numéro saisi dans
  le champ e-mail (`"04.74.93.00.54 - recrutement@x.fr"`), donc `contactPhone` vide,
  colonne Téléphone à « — » et e-mails pollués (lien `mailto:` sur un numéro, e-mail
  faux à l'export CSV). Un `splitContactFields()` remet chaque information dans son
  champ, à la lecture comme à l'écriture. Un e-mail contenant un tiret n'est jamais
  amputé, un numéro déjà saisi n'est jamais écrasé, et l'opération est idempotente.
- **Écritures non atomiques** : `applications.json` et `cover.json` sont écrits dans un
  fichier temporaire puis renommés. Une coupure en pleine écriture ne peut plus
  tronquer le fichier de données.
- **Import en remplacement sans filet** : une copie horodatée des données est faite
  avant tout import en mode `replace`.

### Modifié

- Le tableau PDF tient compte de la place disponible : plus de cellule tronquée sur
  les jeux de données réalistes (y compris plusieurs pages).
- Le README documente les 15 outils MCP, les routes REST et le rôle des modules
  partagés.

## 2.0.0

Première version publiée : suivi de candidatures (CRUD, filtres, colonnes
personnalisables), API REST auto-documentée (catalogue `/api` + OpenAPI 3.1),
serveur MCP, exports JSON / CSV / PDF et page de garde configurable — le tout sans
aucune dépendance npm.
