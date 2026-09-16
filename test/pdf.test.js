// Tests du générateur PDF : rien de tronqué sur des données réalistes, pagination,
// page de garde, structure du fichier. Aucune donnée réelle n'est lue.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { applicationsPdf } = require("../lib/pdf");

/** Toutes les chaînes écrites dans le PDF (cellules, en-têtes, titres) */
function drawnTexts(pdf) {
  return [...pdf.toString("latin1").matchAll(/\(([^)]*)\) Tj/g)].map((m) => m[1]);
}

/** Le générateur coupe avec « … », encodé en WinAnsi (0x85) dans le fichier */
function truncated(pdf) {
  return drawnTexts(pdf).filter((s) => s.includes("\x85"));
}

function row(over = {}) {
  return {
    id: "x",
    company: "Entreprise",
    position: "Alternance",
    status: "Postulé",
    type: "Alternance",
    dateDemarche: "2026-09-12",
    nextAction: "",
    postalCode: "",
    location: "Lyon",
    source: "HelloWork",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    notes: "",
    ...over,
  };
}

// Jeu qui reproduit la feuille réelle : e-mails longs, numéros, statuts variés
const realiste = [
  row({ company: "Villefontaine", status: "Refus", postalCode: "38090", location: "Villefontaine", contactName: "Contact Habitants", contactPhone: "04 74 18 20 00", contactEmail: "contact.habitants@mairie-villefontaine.fr" }),
  row({ company: "L'Isle-d'Abeau", status: "Refus", postalCode: "38080", location: "L'Isle-d'Abeau", contactPhone: "04 74 93 00 54", contactEmail: "recrutement@bourgoinjallieu.fr" }),
  row({ company: "BJ - Recrutement", status: "Refus", postalCode: "38307", location: "Bourgoin-Jallieu" }),
  row({ company: "Arche Medical", status: "Postulé", postalCode: "69002", location: "Lyon", contactPhone: "04 78 42 58 58", contactEmail: "contact@arche-medical.fr" }),
  row({ company: "Randstad Digital", type: "CDI", status: "Postulé", postalCode: "69007", location: "Lyon", contactPhone: "+33 4 72 59 23 23" }),
  row({ company: "ECILIA", status: "Relance envoyée", postalCode: "69432", location: "Lyon cedex 03", contactPhone: "04 72 83 75 75", contactEmail: "contact@ecilia.fr" }),
  row({ company: "EEMI Lyon", status: "Entretien", postalCode: "69002", location: "Lyon", contactPhone: "07.81.20.75.75", contactEmail: "contact@eemi.com" }),
];

describe("export PDF", () => {
  test("fichier PDF valide, A4 paysage", () => {
    const pdf = applicationsPdf(realiste);
    const text = pdf.toString("latin1");
    assert.match(text.slice(0, 8), /^%PDF-1\.4/);
    assert.match(text, /\/MediaBox \[0 0 842 595\]/);
    assert.match(text, /%%EOF/);
    assert.match(text, /\/Count 1/);
  });

  test("colonnes attendues, y compris le téléphone entre contact et e-mail", () => {
    const texts = drawnTexts(applicationsPdf(realiste));
    for (const header of ["ENTREPRISE", "POSTE", "STATUT", "TYPE", "RELANCE", "DÉMARCHE", "LIEU", "SOURCE", "CONTACT", "TÉLÉPHONE", "EMAIL"]) {
      assert.ok(texts.includes(header), `en-tête « ${header} » absent du PDF`);
    }
  });

  test("aucune cellule tronquée sur un jeu de données réaliste", () => {
    assert.deepEqual(truncated(applicationsPdf(realiste)), []);
  });

  test("une valeur géante ne fait pas tronquer les colonnes courtes", () => {
    const extremes = [
      row({
        company: "Groupe International de Recrutement et Conseil en Ressources Humaines",
        position: "Développeur web et web mobile full-stack (alternance 24 mois) — réf. 12345AB",
        status: "Relance envoyée",
        contactName: "Jean-Baptiste de La Rochefoucauld",
        contactEmail: "recrutement.rh@tres-tres-long-nom-de-domaine-entreprise.fr",
        nextAction: "2026-09-12",
      }),
      ...realiste,
    ];
    const texts = drawnTexts(applicationsPdf(extremes));
    // Statuts, types, dates, villes et téléphones restent lisibles en entier
    for (const attendu of ["Relance envoyée", "Entretien", "Alternance", "CDI", "12/09/2026", "38090 Villefontaine", "69432 Lyon cedex 03", "Bourgoin-Jallieu", "04 74 18 20 00", "04 72 83 75 75"]) {
      assert.ok(texts.includes(attendu), `« ${attendu} » a été tronqué`);
    }
    // Le numéro international, un peu plus long, passe sur deux lignes sans être coupé
    assert.ok(texts.includes("+33 4 72 59") && texts.includes("23 23"), "le téléphone +33 aurait dû passer sur deux lignes");
    // Seules les valeurs démesurées sont coupées, et sur leur deuxième ligne
    const coupes = truncated(applicationsPdf(extremes));
    assert.ok(coupes.length <= 3, `trop de cellules coupées : ${coupes.join(" | ")}`);
    const suitesGeantes = ["de Recrutement et", "web mobile full-stack", "La Rochefouca"];
    for (const coupe of coupes) {
      assert.ok(suitesGeantes.some((prefixe) => coupe.startsWith(prefixe)), `valeur courte coupée : ${coupe}`);
    }
  });

  test("quand la place manque, la valeur passe sur deux lignes au lieu d'être coupée", () => {
    // Contenu volontairement trop large pour la page : les colonnes se compriment
    // et c'est là que le retour à la ligne doit prendre le relais.
    const serre = [
      row({
        company: "Groupe International de Recrutement et Conseil en Ressources Humaines",
        position: "Développeur web et web mobile full-stack (alternance 24 mois) — réf. 12345AB",
        status: "Relance envoyée",
        contactName: "Jean-Baptiste de La Rochefoucauld",
        contactEmail: "recrutement.rh@tres-tres-long-nom-de-domaine-entreprise.fr",
        nextAction: "2026-09-12",
      }),
      ...realiste,
    ];
    const texts = drawnTexts(applicationsPdf(serre));
    // L'adresse, trop longue pour sa colonne, est écrite en deux morceaux :
    // la fin est présente, donc l'e-mail reste lisible en entier.
    assert.ok(texts.some((t) => t.startsWith("recrutement.rh@")), "première ligne de l'e-mail absente");
    assert.ok(texts.includes("domaine-entreprise.fr"), "seconde ligne de l'e-mail absente");
    // Le nom du contact est lui aussi réparti sur deux lignes
    assert.ok(texts.includes("Jean-Baptiste de"), "nom réparti sur deux lignes attendu");
    // Aucune de ces deux valeurs n'est précédée d'un « … »
    assert.ok(!truncated(applicationsPdf(serre)).some((t) => t.includes("domaine-entreprise")));
  });

  test("pagination : l'en-tête du tableau est répété sur chaque page", () => {
    const beaucoup = Array.from({ length: 60 }, (_, i) => row({ company: `Entreprise ${i}`, contactEmail: `contact${i}@exemple.fr` }));
    const text = applicationsPdf(beaucoup).toString("latin1");
    const pages = Number(text.match(/\/Count (\d+)/)[1]);
    assert.ok(pages >= 2, "60 lignes devraient tenir sur plusieurs pages");
    const enTetes = drawnTexts(applicationsPdf(beaucoup)).filter((t) => t === "ENTREPRISE").length;
    assert.equal(enTetes, pages);
    assert.match(text, /Page 1 \/ \d+/);
  });

  test("la page de garde n'apparaît que si elle est activée", () => {
    const sans = applicationsPdf(realiste, { cover: { enabled: false, title: "Mon titre" } }).toString("latin1");
    assert.equal(sans.match(/\/Count (\d+)/)[1], "1");
    const avec = applicationsPdf(realiste, { cover: { enabled: true, title: "TP DEVELOPPEUR WEB", subtitle: "Tableau", text: "Objectif" } }).toString("latin1");
    assert.equal(avec.match(/\/Count (\d+)/)[1], "2");
    assert.ok(drawnTexts(applicationsPdf(realiste, { cover: { enabled: true, title: "TP DEVELOPPEUR WEB" } })).includes("TP DEVELOPPEUR WEB"));
  });

  test("les surfaces suivent la palette chaude de l'interface", () => {
    const text = applicationsPdf(realiste).toString("latin1");
    // Jetons du thème clair de style.css : fond crème, lignes ivoire, bandeau sable
    for (const [surface, jeton] of [["0.969 0.953 0.925", "--bg"], ["1 0.988 0.969", "--card"], ["0.945 0.922 0.882", "--bg-elev"]]) {
      assert.ok(text.includes(`${surface} rg`), `surface ${jeton} absente du PDF`);
    }
    assert.ok(!text.includes("1 1 1 rg"), "le thème ne peint aucun blanc pur");
  });

  test("liste vide : on l'annonce au lieu d'afficher un tableau vide", () => {
    const texts = drawnTexts(applicationsPdf([]));
    assert.ok(texts.some((t) => t.includes("Aucune candidature")));
    assert.ok(!texts.includes("ENTREPRISE"));
  });
});
