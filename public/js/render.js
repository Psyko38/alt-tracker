// Déclencheur de rendu unique.
// --------------------------------------------------------------------------
// Après une mutation d'état, l'écran est redessiné une fois — jamais pièce par
// pièce. Le peintre (`render`, dans app.js) est injecté au démarrage, ce qui
// évite que chaque module ait à connaître les autres.
"use strict";

let painter = null;

/** app.js branche ici la fonction qui redessine l'écran entier. */
export function setRenderer(fn) {
  painter = fn;
}

/** À appeler après toute mutation d'état : un rendu, un seul. */
export function scheduleRender() {
  if (painter) painter();
}
