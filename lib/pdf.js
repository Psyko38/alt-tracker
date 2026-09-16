// Générateur PDF minimal — SANS aucune dépendance (pur Node.js).
// Feuille de suivi A4 paysage : bandeau titre, indicateurs, tableau à pastilles
// de statut, marqueurs de relance et pied de page paginé.
// Fontes : Helvetica standard (encodage WinAnsi, accents gérés).

const { followUpState, fmtDateFR, STATUS_TONE, TYPE_TONE, computeStats } = require("./rules");

// ---------- Format ----------

const PAGE_W = 842; // A4 paysage (points)
const PAGE_H = 595;
const MARGIN = 30;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 34; // bande réservée au pied de page

// ---------- Palette (jetons de l'interface, thème clair de style.css) ----------

/** Couleur hexadécimale → composantes PDF (0 à 1) */
function hex(value) {
  const v = parseInt(value.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.round((c / 255) * 1000) / 1000);
}

// Le PDF est imprimé sur du papier blanc : il reprend donc le thème clair, mais
// avec ses propres surfaces — fond crème, lignes ivoire, filets de sable.
const COLOR = {
  page: hex("#f7f3ec"), // --bg
  row: hex("#fffcf7"), // --card, et fond des pastilles d'indicateurs
  panel: hex("#f1ebe1"), // --bg-elev, bandeau d'en-tête du tableau
  text: hex("#2e2a24"), // --text
  muted: hex("#6d6459"), // --muted
  faint: hex("#968b7d"), // --faint
  line: hex("#e8dfd1"), // --border
  brand: hex("#b1552c"), // --primary
  onBrand: hex("#fffaf4"), // --primary-ink
};

/** Tons [texte, fond] — mêmes jetons que les badges de l'interface */
const TONES = {
  neutral: { fg: hex("#6d6459"), bg: hex("#f2ece2") },
  info: { fg: hex("#4a6570"), bg: hex("#eaf0f1") },
  accent: { fg: hex("#8a5a4a"), bg: hex("#f6ece7") },
  warn: { fg: hex("#a2662b"), bg: hex("#f9efe1") },
  ok: { fg: hex("#4f7a52"), bg: hex("#edf3ea") },
  danger: { fg: hex("#a4442c"), bg: hex("#f8eae4") },
};

// ---------- Colonnes ----------
// Même ordre que le tableau de l'interface (statut avant type, relance avant démarche).
// Les largeurs ne sont PAS figées : elles sont calculées à chaque export d'après le
// contenu réel (voir fitColumns), pour que rien ne soit coupé — e-mails compris —
// tout en remplissant exactement la zone utile (782 pt).
const COLUMNS = [
  { key: "company", label: "Entreprise", bold: true, color: COLOR.text },
  { key: "position", label: "Poste", color: COLOR.text },
  { key: "status", label: "Statut", pill: true },
  { key: "type", label: "Type", size: 6.7, tone: "type" },
  { key: "nextAction", label: "Relance", followup: true, fmt: fmtDateFR },
  { key: "dateDemarche", label: "Démarche", align: "right", fmt: fmtDateFR, color: COLOR.muted },
  { key: "location", label: "Lieu", size: 6.7, color: COLOR.muted, value: (a) => [a.postalCode, a.location].filter(Boolean).join(" ") },
  { key: "source", label: "Source", size: 6.7, color: COLOR.muted },
  // Le contact garde le même ordre que la cellule « Contact » de l'interface :
  // nom, puis téléphone, puis e-mail (chaque information a sa colonne dans le PDF).
  { key: "contactName", label: "Contact", color: COLOR.text },
  { key: "contactPhone", label: "Téléphone", color: COLOR.text },
  { key: "contactEmail", label: "Email", size: 6.7, color: COLOR.brand },
];

// ---------- Mise en page ----------

const PAD = 6; // marge intérieure d'une cellule
const ROW_H = 16;
const LINE_H = 9.6; // interligne des cellules sur deux lignes
const TH_H = 20;
const CHIP_H = 34;
const PILL_H = 11;
const PILL_SIZE = 6.8;
const CELL_SIZE = 7.2;
const HEAD_SIZE = 6.8;

// Haut de la bande d'en-tête du tableau, par type de page (le bandeau est dessiné
// sous cette ordonnée, et les lignes commencent juste en dessous). Avant, TH_H était
// retiré une seconde fois : le tableau descendait de 20 pt et laissait un grand vide
// sous les indicateurs.
const TABLE_TOP_FIRST = PAGE_H - MARGIN - 36 - 13 - CHIP_H - 16;
const TABLE_TOP_NEXT = PAGE_H - MARGIN - 18 - 12;
// Marge basse laissée libre sous le tableau, et espace avant la bande des indicateurs
const COVER_CHIPS_Y = 96;
const HEAD_CHARSPACE = 0.35; // interlettrage des en-têtes (sert aussi au calcul des largeurs)

// ---------- Encodage WinAnsi (accents) ----------

const WIN_ANSI_EXTRA = {
  "\u20AC": "\x80", "\u201A": "\x82", "\u2019": "\x92", "\u2018": "\x91",
  "\u201C": "\x93", "\u201D": "\x94", "\u2013": "\x96", "\u2014": "\x97",
  "\u2026": "\x85", "\u0153": "\x9C", "\u0152": "\x8C",
};

function esc(text) {
  let out = "";
  for (const ch of String(text ?? "")) {
    let c = WIN_ANSI_EXTRA[ch] ?? ch;
    if (c.charCodeAt(0) > 255) c = "?";
    if (c === "\\" || c === "(" || c === ")") out += "\\";
    out += c;
  }
  return out;
}

/** Nombre au format PDF (2 décimales, sans notation exponentielle) */
function n(value) {
  return Number(value || 0).toFixed(2);
}

// ---------- Largeurs Helvetica (fractions d'em) ----------

const W_REG = {
  " ": 0.278, "!": 0.278, '"': 0.355, "#": 0.556, $: 0.556, "%": 0.889, "&": 0.667,
  "'": 0.191, "(": 0.333, ")": 0.333, "*": 0.389, "+": 0.584, ",": 0.278, "-": 0.333,
  ".": 0.278, "/": 0.278, "0": 0.556, "1": 0.556, "2": 0.556, "3": 0.556, "4": 0.556,
  "5": 0.556, "6": 0.556, "7": 0.556, "8": 0.556, "9": 0.556, ":": 0.278, ";": 0.278,
  "<": 0.584, "=": 0.584, ">": 0.584, "?": 0.556, "@": 1.015, A: 0.667, B: 0.667,
  C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722, I: 0.278, J: 0.5,
  K: 0.667, L: 0.556, M: 0.833, N: 0.722, O: 0.778, P: 0.667, Q: 0.778, R: 0.722,
  S: 0.667, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667, Y: 0.667, Z: 0.611,
  "[": 0.278, "]": 0.278, a: 0.556, b: 0.556, c: 0.5, d: 0.556, e: 0.556, f: 0.278,
  g: 0.556, h: 0.556, i: 0.222, j: 0.222, k: 0.5, l: 0.222, m: 0.833, n: 0.556,
  o: 0.556, p: 0.556, q: 0.556, r: 0.333, s: 0.5, t: 0.278, u: 0.556, v: 0.5,
  w: 0.722, x: 0.5, y: 0.5, z: 0.5, "…": 1,
};

// Les accents ont la même largeur que leur lettre de base en Helvetica
const ACCENT_BASE = {
  "à": "a", "â": "a", "ä": "a", "á": "a", "ã": "a", "å": "a",
  "é": "e", "è": "e", "ê": "e", "ë": "e", "€": "e",
  "î": "i", "ï": "i", "í": "i",
  "ô": "o", "ö": "o", "ó": "o", "õ": "o",
  "ù": "u", "û": "u", "ü": "u", "ú": "u",
  "ÿ": "y",
  "ç": "c", "ñ": "n",
  "œ": "o", "Œ": "O",
  "À": "A", "Â": "A", "Ä": "A", "É": "E", "È": "E", "Ê": "E", "Ë": "E",
  "Î": "I", "Ï": "I", "Ô": "O", "Ö": "O", "Ù": "U", "Û": "U", "Ü": "U",
  "Ç": "C", "Ñ": "N",
};

/** Copie la largeur des accents depuis leur lettre de base (utile pour les 2 fontes) */
function applyAccentWidths(table) {
  for (const [acc, base] of Object.entries(ACCENT_BASE)) {
    if (table[base] !== undefined) table[acc] = table[base];
  }
}

applyAccentWidths(W_REG);

const W_BOLD = {
  ...W_REG,
  a: 0.556, b: 0.611, c: 0.556, d: 0.611, e: 0.556, f: 0.333, g: 0.611, h: 0.611,
  i: 0.278, j: 0.278, k: 0.556, l: 0.278, m: 0.889, n: 0.611, o: 0.611, p: 0.611,
  q: 0.611, r: 0.389, s: 0.556, t: 0.333, u: 0.611, v: 0.556, w: 0.778, x: 0.556,
  y: 0.556, z: 0.5, A: 0.722, B: 0.722, C: 0.722, D: 0.722, E: 0.667, F: 0.611,
  G: 0.778, H: 0.722, I: 0.389, J: 0.556, K: 0.722, L: 0.611, M: 0.889, N: 0.722,
  O: 0.778, P: 0.667, Q: 0.778, R: 0.722, S: 0.667, T: 0.611, U: 0.722, V: 0.667,
  W: 1, X: 0.667, Y: 0.667, Z: 0.611, " ": 0.278, ":": 0.333, "@": 0.975, "…": 1,
};

// W_BOLD étale W_REG (donc des largeurs « regular » sur les accents) : on les rafraîchit
applyAccentWidths(W_BOLD);

function charCount(text) {
  return [...String(text ?? "")].length;
}

function textWidth(text, size, bold, charSpace = 0) {
  const table = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const ch of String(text ?? "")) w += table[ch] ?? 0.55;
  return w * size + Math.max(0, charCount(text) - 1) * charSpace;
}

/** Tronque avec « … » si le texte dépasse la largeur donnée */
function truncToWidth(text, size, bold, maxW, charSpace = 0) {
  let s = String(text ?? "");
  if (maxW <= 0) return "";
  // Tolérance de 0,05 pt : invisible à l'impression, mais évite qu'une colonne
  // pile à la bonne largeur (arrondie au centième) ne perde son dernier caractère
  if (textWidth(s, size, bold, charSpace) <= maxW + 0.05) return s;
  while (s.length > 0 && textWidth(s + "…", size, bold, charSpace) > maxW) s = s.slice(0, -1);
  return s ? s + "…" : "";
}

/**
 * Découpe un texte en au plus `maxLines` lignes tenant dans maxW : les mots sont
 * respectés, un mot plus long que la colonne (une adresse e-mail, par exemple) est
 * coupé, et la dernière ligne garde son « … » si ça ne suffit toujours pas. Deux
 * lignes complètes valent mieux qu'une seule coupée.
 * @returns {string[]} 1 à maxLines lignes
 */
function wrapToLines(text, size, bold, maxW, maxLines = 2) {
  const s = String(text ?? "");
  if (maxW <= 0 || !s) return [truncToWidth(s, size, bold, maxW)];
  if (textWidth(s, size, bold) <= maxW + 0.05) return [s];

  const lines = [];
  let rest = s;
  while (rest && lines.length < maxLines) {
    if (textWidth(rest, size, bold) <= maxW + 0.05) {
      lines.push(rest);
      break;
    }
    // Dernière ligne autorisée : on tronque plutôt que de dépasser
    if (lines.length === maxLines - 1) {
      lines.push(truncToWidth(rest, size, bold, maxW));
      break;
    }
    let cut = rest.length;
    while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > maxW) cut -= 1;
    // On recule jusqu'à une frontière de mot quand il y en a une
    const space = rest.lastIndexOf(" ", cut);
    const breakAt = space > 0 ? space : cut;
    lines.push(rest.slice(0, breakAt).trim());
    rest = rest.slice(breakAt).trim();
  }
  return lines.length ? lines : [truncToWidth(s, size, bold, maxW)];
}

/**
 * Découpe un texte en lignes qui tiennent dans maxW (retours à la ligne respectés,
 * mots trop longs coupés). Sert à la page de garde : c'est le seul endroit du PDF
 * où l'on écrit du texte libre sur plusieurs lignes.
 */
function wrapText(text, size, bold, maxW) {
  const lines = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) <= maxW) { line = candidate; continue; }
      if (line) lines.push(line);
      let rest = word;
      while (textWidth(rest, size, bold) > maxW && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut) + "…", size, bold) > maxW) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
  }
  return lines;
}

// ---------- Briques de dessin ----------

function drawText(x, y, text, { size = CELL_SIZE, bold = false, color = COLOR.text, align = "left", charSpace = 0 } = {}) {
  const w = textWidth(text, size, bold, charSpace);
  let tx = x;
  if (align === "right") tx = x - w;
  else if (align === "center") tx = x - w / 2;
  return `BT /F${bold ? 2 : 1} ${size} Tf ${color.join(" ")} rg ${n(charSpace)} Tc 1 0 0 1 ${n(tx)} ${n(y)} Tm (${esc(text)}) Tj ET`;
}

function rect(x, y, w, h, color) {
  return `${color.join(" ")} rg ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`;
}

/** Rectangle à coins arrondis (rayon r), rempli */
function roundRect(x, y, w, h, r, color) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = radius * 0.5523;
  const ops = [
    `${color.join(" ")} rg`,
    `${n(x + radius)} ${n(y)} m`,
    `${n(x + w - radius)} ${n(y)} l`,
    `${n(x + w - radius + k)} ${n(y)} ${n(x + w)} ${n(y + radius - k)} ${n(x + w)} ${n(y + radius)} c`,
    `${n(x + w)} ${n(y + h - radius)} l`,
    `${n(x + w)} ${n(y + h - radius + k)} ${n(x + w - radius + k)} ${n(y + h)} ${n(x + w - radius)} ${n(y + h)} c`,
    `${n(x + radius)} ${n(y + h)} l`,
    `${n(x + radius - k)} ${n(y + h)} ${n(x)} ${n(y + h - radius + k)} ${n(x)} ${n(y + h - radius)} c`,
    `${n(x)} ${n(y + radius)} l`,
    `${n(x)} ${n(y + radius - k)} ${n(x + radius - k)} ${n(y)} ${n(x + radius)} ${n(y)} c`,
    "f",
  ];
  return ops.join(" ");
}

function hline(x1, x2, y, color = COLOR.line, width = 0.5) {
  return `${color.join(" ")} RG ${width} w ${n(x1)} ${n(y)} m ${n(x2)} ${n(y)} l S`;
}

/**
 * Ordonnée de la ligne de base pour centrer optiquement un texte sur centerY.
 * Le signe compte : la ligne de base est SOUS le centre (le texte monte au-dessus),
 * sinon tout le contenu (chips, en-têtes, cellules, pastilles, logo) apparaissait
 * décalé vers le haut d'environ 0,6 fois la taille de la police.
 */
function baseline(centerY, size) {
  return centerY - size * 0.3;
}

// ---------- Dimensionnement des colonnes ----------

/**
 * Contenu d'une cellule, indépendamment de la place disponible : c'est la même
 * source de vérité pour mesurer une colonne et pour la dessiner.
 * @returns {{kind: "pill"|"text", text: string, size: number, bold?: boolean, color: number[], bg?: number[], align?: string}}
 */
function cellContent(col, app, state) {
  const size = col.size || CELL_SIZE;

  if (col.pill) {
    const tone = TONES[STATUS_TONE[app.status] || "neutral"];
    return { kind: "pill", text: app.status || "—", size: PILL_SIZE, bold: true, color: tone.fg, bg: tone.bg };
  }

  if (col.tone === "type") {
    const value = app.type || "";
    if (!value) return { kind: "text", text: "—", size, color: COLOR.faint };
    return { kind: "text", text: value, size, color: TONES[TYPE_TONE[value] || "neutral"].fg };
  }

  if (col.followup) {
    const label = (app.nextAction && col.fmt(app.nextAction)) || (state === "overdue" ? "à relancer" : "");
    if (!label) return { kind: "text", text: "—", size, color: COLOR.faint };
    const color = state === "due" ? TONES.warn.fg : state === "overdue" ? TONES.danger.fg : COLOR.muted;
    return { kind: "text", text: label, size, bold: Boolean(state), color };
  }

  const value = col.value ? col.value(app) : app[col.key];
  const text = col.fmt ? col.fmt(value) : String(value ?? "");
  if (!text) return { kind: "text", text: "—", size, color: COLOR.faint, align: col.align };
  return { kind: "text", text, size, bold: Boolean(col.bold), color: col.color || COLOR.text, align: col.align };
}

/** Largeur de colonne nécessaire pour afficher une cellule en entier */
function cellColumnWidth(cell) {
  if (cell.kind === "pill") return textWidth(cell.text, cell.size, true) + 14 + 4; // pastille + marge
  return textWidth(cell.text, cell.size, cell.bold) + PAD * 2;
}

/** Largeur minimale d'une colonne : son en-tête entier, jamais coupé */
function headWidth(col) {
  return textWidth(col.label.toUpperCase(), HEAD_SIZE, true, HEAD_CHARSPACE) + PAD * 2;
}

/**
 * Répartit la largeur utile entre les colonnes d'après leur contenu :
 * au minimum la place de leur en-tête, au plus celle de leur plus longue cellule.
 * Le surplus est redistribué au prorata du contenu, pour que le tableau continue
 * de remplir toute la page ; si le contenu déborde (très long e-mail, poste
 * interminable…), les colonnes les plus larges se compriment en premier, jusqu'à
 * leur minimum : seules les quelques valeurs exceptionnellement longues d'une
 * colonne cèdent, le reste du tableau reste lisible en entier.
 */
function fitColumns(list) {
  const head = COLUMNS.map(headWidth);
  const natural = head.slice();
  // Besoins réels de chaque cellule (celles qui dépassent l'en-tête)
  const needs = COLUMNS.map(() => []);
  for (const app of list) {
    COLUMNS.forEach((col, i) => {
      const need = cellColumnWidth(cellContent(col, app, followUpState(app)));
      if (need > natural[i]) natural[i] = need;
      if (need > head[i]) needs[i].push(need);
    });
  }
  // Minimum d'une colonne : la largeur qui affiche entièrement ~90 % de ses valeurs
  // (jamais moins que son en-tête). Autrement dit, seule une poignée de valeurs
  // exceptionnellement longues peut être tronquée, les autres restent lisibles.
  let floor = COLUMNS.map((_, i) => {
    if (!needs[i].length) return head[i];
    needs[i].sort((a, b) => a - b);
    const idx = Math.min(needs[i].length - 1, Math.floor((needs[i].length - 1) * 0.9));
    return Math.max(head[i], needs[i][idx]);
  });
  let totalFloor = floor.reduce((s, w) => s + w, 0);
  // Données pathologiques (toutes les colonnes immenses) : on retombe sur les en-têtes
  if (totalFloor > CONTENT_W) {
    floor = head;
    totalFloor = head.reduce((s, w) => s + w, 0);
  }
  const totalNatural = natural.reduce((s, w) => s + w, 0);

  let widths;
  if (totalNatural <= CONTENT_W) {
    // Tout tient : on élargit chaque colonne au prorata de son contenu
    const extra = CONTENT_W - totalNatural;
    widths = natural.map((w) => w + (extra * w) / totalNatural);
  } else if (totalFloor >= CONTENT_W) {
    // Même les en-têtes ne tiennent pas (improbable) : on réduit tout
    widths = floor.map((w) => (CONTENT_W * w) / totalFloor);
  } else {
    // Trop large : les plus grosses colonnes cèdent la place jusqu'à leur minimum,
    // les autres gardent de quoi afficher leur contenu entier
    widths = natural.slice();
    let pool = COLUMNS.map((_, i) => i);
    let available = CONTENT_W;
    let poolNatural = totalNatural;
    while (pool.length) {
      const scale = available / poolNatural;
      const clamped = pool.filter((i) => natural[i] * scale < floor[i]);
      if (!clamped.length) {
        for (const i of pool) widths[i] = natural[i] * scale;
        break;
      }
      for (const i of clamped) {
        widths[i] = floor[i];
        available -= floor[i];
        poolNatural -= natural[i];
      }
      pool = pool.filter((i) => !clamped.includes(i));
    }
  }

  // Le total doit tomber pile sur la largeur utile : la dernière colonne absorbe l'arrondi
  let used = 0;
  COLUMNS.forEach((col, i) => {
    const last = i === COLUMNS.length - 1;
    col.width = last ? CONTENT_W - used : Math.round(widths[i] * 100) / 100;
    used += col.width;
  });
}

// ---------- Statistiques ----------

/**
 * Statistiques de repli si l'appelant ne les fournit pas : elles portent sur la
 * liste reçue (donc sur la sélection exportée), via la même règle que l'interface.
 */
function fallbackStats(list) {
  const s = computeStats(list);
  return { ...s, interviewRate: s.rate };
}

// ---------- Génération ----------

/**
 * Génère le PDF (Buffer) de la feuille de suivi.
 * @param {Array} apps candidatures (déjà normalisées par le store)
 * @param {{generatedAt?: string|Date, stats?: object}} opts
 */
function applicationsPdf(apps, opts = {}) {
  const list = Array.isArray(apps) ? apps : [];
  const generatedAt = opts.generatedAt ? new Date(opts.generatedAt) : new Date();
  const stats = opts.stats || fallbackStats(list);
  const genLabel = `Généré le ${generatedAt.toLocaleDateString("fr-FR")} à ${generatedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

  // Page de garde (optionnelle) : elle devient la page 1, le tableau suit à partir
  // de la page 2. Sans elle, le PDF garde son en-tête d'origine avec les indicateurs.
  const cover = opts.cover && typeof opts.cover === "object" ? opts.cover : {};
  const coverEnabled = Boolean(cover.enabled);
  const coverTitle = String(cover.title || "").trim();
  const coverSubtitle = String(cover.subtitle || "").trim();
  const coverText = String(cover.text || "").trim();
  const coverStats = cover.showStats !== false;
  const docTitle = coverTitle || "Suivi de candidatures";
  // Sélection exportée : un PDF filtré doit dire sur quoi il porte, sinon « 3
  // candidatures » face à un suivi de 40 ressemble à une perte de données.
  const selectionLabel = opts.selection && opts.selection.label ? String(opts.selection.label).trim() : "";
  const selectionTotal = opts.selection ? Number(opts.selection.total) : 0;
  const docSubtitle =
    `Jobs, alternance, stages — ${list.length} candidature${list.length > 1 ? "s" : ""}` +
    (Number.isFinite(selectionTotal) && selectionTotal > list.length ? ` sur ${selectionTotal}` : "") +
    (selectionLabel ? ` · ${selectionLabel}` : "");

  // Largeurs calculées d'après le contenu, puis positions horizontales des colonnes
  fitColumns(list);
  let cx = MARGIN;
  for (const col of COLUMNS) {
    col.x = cx;
    cx += col.width;
  }

  const pages = [];
  let ops = [];
  let pageIndex = 0;
  let y = 0; // ordonnée courante = bas de la dernière bande dessinée

  // ----- Bandeaux -----

  /** Première page « classique » : identité, indicateurs, puis le tableau */
  function drawCoverHeader() {
    const top = PAGE_H - MARGIN;

    // Pastille logo
    ops.push(roundRect(MARGIN, top - 26, 26, 26, 8, COLOR.brand));
    ops.push(drawText(MARGIN + 13, baseline(top - 13, 9.5), "JT", { size: 9.5, bold: true, color: COLOR.onBrand, align: "center", charSpace: 0.4 }));

    ops.push(drawText(MARGIN + 36, top - 10, truncToWidth(docTitle, 15, true, CONTENT_W - 160), { size: 15, bold: true, color: COLOR.text }));
    ops.push(drawText(MARGIN + 36, top - 23, docSubtitle, { size: 8.5, color: COLOR.muted }));

    ops.push(drawText(PAGE_W - MARGIN, top - 10, genLabel, { size: 7.5, color: COLOR.faint, align: "right" }));

    ops.push(hline(MARGIN, PAGE_W - MARGIN, top - 36, COLOR.brand, 1.6));

    drawChips(top - 36 - 13 - CHIP_H);
    y = TABLE_TOP_FIRST;
  }

  /**
   * Page de garde : la page 1 du PDF quand l'utilisateur en a activé une.
   * Identité discrète en haut, puis son titre, son sous-titre et son texte libre
   * (mis en page sur plusieurs lignes, tronqué si c'est trop long), et enfin les
   * indicateurs — le tableau commence page 2.
   */
  function drawCoverPage() {
    const top = PAGE_H - MARGIN;
    const textTop = 96 + CHIP_H + 26; // garde-fou au-dessus de la bande d'indicateurs

    // Filet de marque + bloc d'identité
    ops.push(roundRect(MARGIN, top - 6, CONTENT_W, 6, 3, COLOR.brand));
    ops.push(roundRect(MARGIN, top - 48, 30, 30, 10, COLOR.brand));
    ops.push(drawText(MARGIN + 15, baseline(top - 33, 11), "JT", { size: 11, bold: true, color: COLOR.onBrand, align: "center", charSpace: 0.4 }));
    ops.push(drawText(MARGIN + 42, baseline(top - 24, 8.2), "SUIVI DE CANDIDATURES", { size: 8.2, bold: true, color: COLOR.muted, charSpace: 0.5 }));
    ops.push(drawText(MARGIN + 42, baseline(top - 39, 7.4), docSubtitle, { size: 7.4, color: COLOR.faint }));
    ops.push(drawText(PAGE_W - MARGIN, baseline(top - 24, 7.5), genLabel, { size: 7.5, color: COLOR.faint, align: "right" }));

    // Titre (2 lignes maximum, coupé avec « … » si besoin)
    const titleSize = 26;
    let titleLines = wrapText(coverTitle || docTitle, titleSize, true, CONTENT_W);
    if (titleLines.length > 2) {
      titleLines = [titleLines[0], truncToWidth(titleLines.slice(1).join(" "), titleSize, true, CONTENT_W)];
    }
    let cursor = top - 96;
    for (const line of titleLines) {
      ops.push(drawText(MARGIN, cursor, line, { size: titleSize, bold: true, color: COLOR.text }));
      cursor -= titleSize + 6;
    }

    // Sous-titre (2 lignes maximum)
    const subSize = 12.5;
    const subLines = coverSubtitle ? wrapText(coverSubtitle, subSize, false, CONTENT_W * 0.85).slice(0, 2) : [];
    cursor -= 10;
    for (const line of subLines) {
      ops.push(drawText(MARGIN, cursor, line, { size: subSize, color: COLOR.muted }));
      cursor -= subSize + 4;
    }

    // Texte libre
    if (coverText) {
      cursor -= 12;
      ops.push(hline(MARGIN, MARGIN + CONTENT_W * 0.32, cursor + 4, COLOR.brand, 1.2));
      cursor -= 18;
      const size = 10;
      const leading = size + 4.5;
      const maxLines = Math.max(0, Math.floor((cursor - textTop) / leading));
      const lines = wrapText(coverText, size, false, CONTENT_W * 0.78);
      const kept = lines.slice(0, maxLines);
      if (lines.length > kept.length) {
        kept[kept.length - 1] = truncToWidth(kept[kept.length - 1] + " …", size, false, CONTENT_W * 0.78);
      }
      for (const line of kept) {
        ops.push(drawText(MARGIN, cursor, line, { size, color: COLOR.text }));
        cursor -= leading;
      }
    }

    if (coverStats) drawChips(96);
  }

  function drawChips(chipsY) {
    const chips = [
      { label: "Candidatures", value: stats.total, color: COLOR.text },
      { label: "Envoyées", value: stats.sent, color: TONES.info.fg },
      { label: "Entretiens / offres", value: stats.interviews, color: TONES.accent.fg },
      { label: "Taux de réponse", value: `${stats.interviewRate ?? 0} %`, color: COLOR.text },
      { label: "À relancer", value: stats.followUps, color: stats.followUps ? TONES.warn.fg : COLOR.faint, highlight: stats.followUps > 0 },
    ];
    const gap = 8;
    const w = (CONTENT_W - gap * (chips.length - 1)) / chips.length;

    chips.forEach((chip, i) => {
      const x = MARGIN + i * (w + gap);
      ops.push(roundRect(x, chipsY, w, CHIP_H, 8, chip.highlight ? TONES.warn.bg : COLOR.row));
      ops.push(drawText(x + 12, baseline(chipsY + CHIP_H / 2, 11), String(chip.value), { size: 11, bold: true, color: chip.color }));
      ops.push(
        drawText(x + w - 12, baseline(chipsY + CHIP_H / 2, 6.5), chip.label.toUpperCase(), {
          size: 6.5,
          bold: true,
          color: chip.highlight ? TONES.warn.fg : COLOR.muted,
          align: "right",
          charSpace: 0.3,
        })
      );
    });
  }

  function drawContinuation(subtitle = "— suite") {
    const top = PAGE_H - MARGIN;
    const title = truncToWidth(docTitle, 10.5, true, CONTENT_W * 0.55);
    ops.push(drawText(MARGIN, top - 10, title, { size: 10.5, bold: true, color: COLOR.text }));
    ops.push(drawText(MARGIN + textWidth(title, 10.5, true) + 8, top - 10, subtitle, { size: 9, color: COLOR.faint }));
    ops.push(drawText(PAGE_W - MARGIN, top - 10, genLabel, { size: 7.5, color: COLOR.faint, align: "right" }));
    ops.push(hline(MARGIN, PAGE_W - MARGIN, top - 18, COLOR.line, 0.8));
    y = TABLE_TOP_NEXT;
  }

  function drawTableHeader() {
    const bottom = y - TH_H;
    ops.push(roundRect(MARGIN, bottom, CONTENT_W, TH_H, 6, COLOR.panel));
    for (const col of COLUMNS) {
      const anchor = col.align === "right" ? col.x + col.width - PAD : col.x + PAD;
      ops.push(
        drawText(anchor, baseline(bottom + TH_H / 2, HEAD_SIZE), col.label.toUpperCase(), {
          size: HEAD_SIZE,
          bold: true,
          color: COLOR.muted,
          align: col.align,
          charSpace: HEAD_CHARSPACE,
        })
      );
    }
    y = bottom;
  }

  // ----- Lignes -----

  /**
   * Prépare une ligne : contenu de chaque cellule, découpé sur une ou deux lignes
   * selon la place disponible, et hauteur qui en découle. Calculée à part du dessin
   * parce que la pagination doit connaître la hauteur AVANT de décider de tourner
   * la page.
   */
  function rowLayout(app) {
    const state = followUpState(app);
    const cells = COLUMNS.map((col) => {
      const cell = cellContent(col, app, state);
      const maxW = col.width - PAD * 2;
      // Une pastille de statut reste sur une ligne : c'est une étiquette, pas du texte
      const lines =
        cell.kind === "pill"
          ? [truncToWidth(cell.text, cell.size, true, maxW)]
          : wrapToLines(cell.text, cell.size, cell.bold, maxW, 2);
      return { col, cell, lines };
    });
    const lineCount = Math.max(...cells.map((c) => c.lines.length));
    return { state, cells, height: ROW_H + (lineCount - 1) * LINE_H };
  }

  function drawRow(app, index, layout) {
    const { state, cells, height } = layout;
    const bottom = y - height;
    const rowTop = bottom;
    const centerY = bottom + height / 2;

    // Surface ivoire de la ligne + séparateur de sable (comme le tableau de
    // l'interface : pas de zébrage, le rythme vient des filets)
    ops.push(rect(MARGIN, bottom, CONTENT_W, height, COLOR.row));
    ops.push(hline(MARGIN, PAGE_W - MARGIN, bottom, COLOR.line, 0.4));

    // Marqueur de relance : petit trait orange à gauche
    if (state) {
      const markerColor = state === "overdue" ? TONES.danger.fg : TONES.warn.fg;
      ops.push(roundRect(MARGIN + 1, bottom + 3.5, 3, height - 7, 1.5, markerColor));
    }

    for (const { col, cell, lines } of cells) {
      if (cell.kind === "pill") {
        const label = lines[0];
        const pillW = Math.min(col.width - 4, textWidth(label, cell.size, true) + 14);
        const pillX = col.x + (col.width - pillW) / 2;
        const pillY = centerY - PILL_H / 2;
        ops.push(roundRect(pillX, pillY, pillW, PILL_H, PILL_H / 2, cell.bg));
        ops.push(drawText(pillX + pillW / 2, baseline(centerY, cell.size), label, { size: cell.size, bold: true, color: cell.color, align: "center" }));
        continue;
      }

      const anchor = col.align === "right" ? col.x + col.width - PAD : col.x + PAD;
      const n = lines.length;
      lines.forEach((line, i) => {
        // Bloc de lignes centré verticalement dans la ligne du tableau
        const lineCenter = centerY + ((n - 1) / 2 - i) * LINE_H;
        ops.push(
          drawText(anchor, baseline(lineCenter, cell.size), line, {
            size: cell.size,
            bold: Boolean(cell.bold),
            color: cell.color,
            align: col.align,
          })
        );
      });
    }

    y = rowTop;
  }

  function drawEmptyState() {
    // Pas d'en-tête de tableau à dessiner ici : la carte se place directement sous
    // les indicateurs (page normale) ou sous le bandeau de continuité (après une
    // page de garde), avec une respiration de 24 pt.
    const h = 96;
    const top = (pageIndex === 1 ? PAGE_H - MARGIN - 36 - 13 - CHIP_H : TABLE_TOP_NEXT) - 24;
    ops.push(roundRect(MARGIN, top - h, CONTENT_W, h, 10, COLOR.row));
    ops.push(drawText(PAGE_W / 2, top - h / 2 + 8, "Aucune candidature enregistrée", { size: 12, bold: true, color: COLOR.text, align: "center" }));
    ops.push(drawText(PAGE_W / 2, top - h / 2 - 6, "Ajoutez une candidature depuis l'application, puis relancez l'export.", { size: 8.5, color: COLOR.muted, align: "center" }));
  }

  // ----- Assemblage des pages -----

  function startPage() {
    // Fond crème de la page, poussé en premier : tout le reste se dessine dessus
    ops = [rect(0, 0, PAGE_W, PAGE_H, COLOR.page)];
    pages.push(ops);
    pageIndex += 1;
    // La page de garde ne contient que la garde : le tableau démarre sur la suivante
    if (pageIndex === 1 && coverEnabled) return drawCoverPage();
    if (pageIndex === 1) drawCoverHeader();
    else {
      const base = coverEnabled && pageIndex === 2 ? "— tableau des candidatures" : "— suite";
      // Sur un export filtré, la sélection est rappelée sur chaque page
      drawContinuation(selectionLabel ? `${base} · ${selectionLabel}` : base);
    }
    // Sans candidature, un en-tête de tableau vide n'aurait aucun sens
    if (list.length) drawTableHeader();
  }

  startPage();

  if (!list.length) {
    // Avec une page de garde, la page « vide » est la deuxième
    if (coverEnabled) startPage();
    drawEmptyState();
  } else {
    list.forEach((app, i) => {
      // La hauteur dépend du contenu (une ou deux lignes), donc on la calcule
      // avant de décider de passer à la page suivante.
      const layout = rowLayout(app);
      if (y - layout.height < FOOTER_H + 8) startPage();
      drawRow(app, i, layout);
    });
  }

  // Pied de page (après coup : on connaît le nombre total de pages)
  const plural = list.length > 1 ? "s" : "";
  pages.forEach((pageOps, i) => {
    pageOps.push(hline(MARGIN, PAGE_W - MARGIN, FOOTER_H - 6, COLOR.line, 0.5));
    pageOps.push(drawText(MARGIN, FOOTER_H - 18, `${list.length} candidature${plural} suivie${plural}`, { size: 6.8, color: COLOR.faint }));
    pageOps.push(drawText(PAGE_W / 2, FOOTER_H - 18, `Page ${i + 1} / ${pages.length}`, { size: 6.8, color: COLOR.faint, align: "center" }));
    pageOps.push(drawText(PAGE_W - MARGIN, FOOTER_H - 18, genLabel, { size: 6.8, color: COLOR.faint, align: "right" }));
  });

  return assemble(pages, { title: "Suivi de candidatures", createdAt: generatedAt });
}

// ---------- Assemblage du fichier PDF (xref avec offsets exacts) ----------

function pdfDate(date) {
  const p = (v) => String(v).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

function assemble(pages, meta = {}) {
  // 1 : catalogue, 2 : pages, 3-4 : fontes, 5 : infos, puis par page [flux, page]
  const objects = [];
  const pageLayout = [];
  pages.forEach((ops) => {
    const streamObjNum = 6 + pageLayout.length * 2;
    pageLayout.push({ stream: ops.join("\n"), streamObjNum, pageObjNum: streamObjNum + 1 });
  });

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageLayout.map((p) => `${p.pageObjNum} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  objects.push(
    `<< /Title (${esc(meta.title || "Suivi de candidatures")}) /Author (job-tracker) /Creator (job-tracker) /Producer (job-tracker, sans dépendance) /CreationDate (${pdfDate(meta.createdAt || new Date())}) >>`
  );

  pageLayout.forEach(({ stream, streamObjNum, pageObjNum }) => {
    // Objet flux de contenu, avec /Length exact (obligatoire)
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    // Objet page, distinct du flux
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObjNum} 0 R >>`
    );
  });

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

module.exports = { applicationsPdf };
