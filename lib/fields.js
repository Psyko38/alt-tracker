// Le schéma d'une candidature : quels champs existent, lesquels sont obligatoires,
// leur type et leur longueur maximale. C'est la définition que lisent la
// validation (lib/model.js), l'encodage SQL (lib/sqlite.js) et la documentation de
// l'API (server.js, mcp-server.js) — une colonne ajoutée ici se propage partout.
//
// La liste des dates filtrables (`DATE_FIELDS`) n'est PAS redéfinie ici : elle
// appartient aux règles (lib/rules.js), et ses consommateurs la prennent chez
// elle. La redériver depuis le schéma en faisait une seconde vérité qui devait
// rester d'accord avec celle des règles — exactement ce que ce module évite
// ailleurs en prenant déjà `STATUSES` et `TYPES` chez elles.
const { STATUSES, TYPES } = require("./rules");

const FIELD_DEFS = [
  { name: "company", type: "string", required: true, desc: "Nom de l'entreprise" },
  { name: "position", type: "string", required: true, desc: "Intitulé du poste" },
  { name: "status", type: "string", required: false, enum: STATUSES, desc: "Statut de la candidature" },
  { name: "type", type: "string", required: false, enum: TYPES, desc: "Type de contrat" },
  { name: "dateDemarche", type: "date", required: false, desc: "Date de la démarche (YYYY-MM-DD ou JJ/MM/AAAA)" },
  { name: "postalCode", type: "string", required: false, desc: "Code postal du lieu" },
  { name: "location", type: "string", required: false, desc: "Lieu (ville / télétravail)" },
  { name: "source", type: "string", required: false, desc: "Source de l'offre (LinkedIn, HelloWork…)" },
  { name: "salary", type: "string", required: false, desc: "Salaire mentionné" },
  { name: "url", type: "string", required: false, desc: "Lien vers l'offre" },
  { name: "contactName", type: "string", required: false, desc: "Contact : Nom Prénom" },
  { name: "contactEmail", type: "email", required: false, desc: "Contact : email" },
  { name: "contactPhone", type: "string", required: false, desc: "Contact : téléphone" },
  { name: "nextAction", type: "date", required: false, desc: "Prochaine action / relance prévue (YYYY-MM-DD)" },
  { name: "notes", type: "string", required: false, desc: "Notes libres" },
];

const STRING_FIELDS = FIELD_DEFS.filter((field) => field.type !== "date").map((field) => field.name);
const FIELD_LIMITS = {
  company: 300,
  position: 300,
  status: 100,
  type: 100,
  postalCode: 20,
  location: 300,
  source: 200,
  salary: 200,
  url: 2048,
  contactName: 200,
  contactEmail: 320,
  contactPhone: 80,
  notes: 10000,
};

module.exports = { FIELD_DEFS, STRING_FIELDS, FIELD_LIMITS };
