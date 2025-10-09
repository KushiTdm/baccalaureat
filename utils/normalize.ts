export function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeWord(word: string): string {
  return removeAccents(word.toLowerCase().trim());
}
