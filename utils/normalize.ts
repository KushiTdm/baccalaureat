export function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeWord(word: string): string {
  return removeAccents(word.toLowerCase().trim());
}

// Vérifie que le mot commence par la lettre imposée, accents ignorés :
// « Éléphant » doit être accepté pour la lettre E.
export function startsWithLetter(word: string, letter: string): boolean {
  if (!word || !letter) return false;
  return normalizeWord(word).startsWith(normalizeWord(letter));
}
