// La page de garde du PDF : les libellés rédigés dans « Exporter → Page de garde ».
// Elle vit dans la même base que les candidatures (table `cover`, une seule ligne)
// mais c'est une autre notion : sa normalisation, ses limites et sa lecture/écriture
// n'ont rien à voir avec une candidature.
const { getDb } = require("./sqlite");

const COVER_DEFAULTS = Object.freeze({ enabled: false, title: "", subtitle: "", text: "", showStats: true });
const COVER_LIMITS = Object.freeze({ title: 120, subtitle: 200, text: 4000 });

function normalizeCover(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const cover = { ...COVER_DEFAULTS };
  for (const key of ["title", "subtitle", "text"]) {
    cover[key] = source[key] === undefined
      ? ""
      : String(source[key] ?? "").replace(/\r\n/g, "\n").trim().slice(0, COVER_LIMITS[key]);
  }
  cover.enabled = source.enabled === true;
  cover.showStats = source.showStats === undefined ? true : source.showStats === true;
  return cover;
}

function readCover() {
  const row = getDb().prepare("SELECT enabled, title, subtitle, text, show_stats FROM cover WHERE id = 1").get();
  return row
    ? normalizeCover({ enabled: Boolean(row.enabled), title: row.title, subtitle: row.subtitle, text: row.text, showStats: Boolean(row.show_stats) })
    : { ...COVER_DEFAULTS };
}

/** Enregistre une page de garde en la fusionnant avec celle déjà là */
function saveCover(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return writeCover(getDb(), { ...readCover(), ...source });
}

/**
 * Écrit une page de garde telle quelle (pas de fusion). Prend la connexion en
 * paramètre pour pouvoir rejoindre la transaction d'un import : la fusion de
 * `saveCover` n'a pas de sens quand le fichier apporte sa propre page de garde.
 */
function writeCover(database, cover) {
  const normalized = normalizeCover(cover);
  database.prepare(`
    INSERT OR REPLACE INTO cover (id, enabled, title, subtitle, text, show_stats)
    VALUES (1, @enabled, @title, @subtitle, @text, @show_stats)
  `).run({
    enabled: normalized.enabled ? 1 : 0,
    title: normalized.title,
    subtitle: normalized.subtitle,
    text: normalized.text,
    show_stats: normalized.showStats ? 1 : 0,
  });
  return normalized;
}

module.exports = { COVER_DEFAULTS, readCover, saveCover, writeCover };
