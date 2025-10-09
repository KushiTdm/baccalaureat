import { Platform } from 'react-native';
import { loadDictionaryFromFile, DictionaryData } from '../utils/storage';
import { normalizeWord } from '../utils/normalize';

let cachedData: DictionaryData | null = null;

export async function initOfflineDatabase(): Promise<void> {
  const data = await loadDictionaryFromFile();
  if (data) {
    cachedData = data;
  }
}

export async function populateOfflineDatabase(data: DictionaryData): Promise<void> {
  cachedData = data;
}

export async function getCategoriesOffline(): Promise<Array<{ id: number; nom: string }>> {
  if (!cachedData) {
    await initOfflineDatabase();
  }

  return cachedData?.categories || [];
}

export async function validateWordOffline(word: string, categorieId: number): Promise<boolean> {
  if (!cachedData) {
    await initOfflineDatabase();
  }

  if (!cachedData) {
    return false;
  }

  const normalized = normalizeWord(word);
  const found = cachedData.mots.find(
    (m) => m.mot_normalized === normalized && m.categorie_id === categorieId
  );

  return found !== undefined;
}

export async function loadOfflineDictionary(): Promise<boolean> {
  const data = await loadDictionaryFromFile();
  if (!data) {
    return false;
  }

  await populateOfflineDatabase(data);
  return true;
}
