// services/offline.ts
import { Platform } from 'react-native';
import { loadDictionaryFromFile, saveDictionaryToFile, DictionaryData } from '../utils/storage';
import { normalizeWord } from '../utils/normalize';

let cachedData: DictionaryData | null = null;

/**
 * Dictionnaire embarqué dans le binaire — dernier recours quand aucun
 * dictionnaire n'a été téléchargé. Le require est protégé par try/catch
 * au cas où le fichier manquerait du bundle.
 */
function loadBundledDictionary(): DictionaryData | null {
  try {
    const data = require('../assets/data/dictionary-fr.json');
    if (data && Array.isArray(data.categories) && Array.isArray(data.mots)) {
      return data as DictionaryData;
    }
    return null;
  } catch (error) {
    console.warn('📦 Dictionnaire embarqué indisponible:', error);
    return null;
  }
}

export async function initOfflineDatabase(): Promise<void> {
  // Priorité 1 : dictionnaire téléchargé (complet)
  const data = await loadDictionaryFromFile();
  if (data) {
    cachedData = data;
    return;
  }

  // Priorité 2 : dictionnaire embarqué (dernier recours, réduit)
  if (!cachedData) {
    const bundled = loadBundledDictionary();
    if (bundled) {
      console.log('📦 Utilisation du dictionnaire embarqué');
      cachedData = bundled;
    }
  }
}

export async function populateOfflineDatabase(data: DictionaryData): Promise<void> {
  cachedData = data;
}

export async function getCategoriesOffline(): Promise<any[]> {
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

/**
 * Ajoute un mot au dictionnaire local (validation manuelle par accord
 * mutuel en Bluetooth/hors-ligne). S'il n'existait aucun dictionnaire
 * téléchargé, on en crée un à partir du dictionnaire embarqué + ce mot :
 * après cet appel, `isDictionaryDownloaded()` renvoie true.
 *
 * Limite connue : un futur "Mettre à jour le dictionnaire" (téléchargement
 * Supabase) écrase ce fichier et perd les mots ajoutés localement — pas de
 * fusion. Acceptable pour l'usage visé (mots ajoutés en partie Bluetooth,
 * rarement suivi d'un re-téléchargement immédiat).
 */
export async function addWordToLocalDictionary(word: string, categorieId: number): Promise<boolean> {
  if (!cachedData) {
    await initOfflineDatabase();
  }
  if (!cachedData) {
    return false;
  }

  const normalized = normalizeWord(word);
  const alreadyThere = cachedData.mots.some(
    (m) => m.mot_normalized === normalized && m.categorie_id === categorieId
  );
  if (alreadyThere) {
    return true;
  }

  const nextId = cachedData.mots.reduce((max, m) => Math.max(max, m.id), 0) + 1;
  cachedData = {
    ...cachedData,
    mots: [
      ...cachedData.mots,
      { id: nextId, mot: word.trim(), mot_normalized: normalized, categorie_id: categorieId },
    ],
  };

  try {
    await saveDictionaryToFile(cachedData);
    return true;
  } catch (error) {
    console.warn("📦 Impossible d'enregistrer le mot dans le dictionnaire local:", error);
    return false;
  }
}
