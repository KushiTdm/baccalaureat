// Lettres jouables du Petit Bac.
// K, Q, W, X, Y et Z sont exclues : trop peu de mots français les commencent
// pour que toutes les catégories restent jouables (règle classique du jeu).
export const GAME_LETTERS = 'ABCDEFGHIJLMNOPRSTUV'.split('');

// Tire une lettre au hasard, en évitant si possible celles déjà utilisées.
export function pickRandomLetter(exclude: string[] = []): string {
  const excludeUpper = exclude.map((l) => l.toUpperCase());
  const pool = GAME_LETTERS.filter((l) => !excludeUpper.includes(l));
  const source = pool.length > 0 ? pool : GAME_LETTERS;
  return source[Math.floor(Math.random() * source.length)];
}
