// services/api.ts
import { supabase, Categorie, Mot } from '../lib/supabase';
import { normalizeWord } from '../utils/normalize';
import * as Network from 'expo-network';
import { validateWordOffline, getCategoriesOffline } from './offline';
import { saveDictionaryToFile, DictionaryData } from '../utils/storage';

export async function isOnline(): Promise<boolean> {
  try {
    const networkState = await Network.getNetworkStateAsync();
    return networkState.isConnected === true && networkState.isInternetReachable === true;
  } catch {
    return false;
  }
}

export async function getCategories(): Promise<Categorie[]> {
  const online = await isOnline();

  if (!online) {
    return getCategoriesOffline();
  }

  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('id');

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

export async function validateWord(word: string, categorieId: number): Promise<boolean> {
  const online = await isOnline();

  if (!online) {
    return validateWordOffline(word, categorieId);
  }

  const normalized = normalizeWord(word);

  const { data, error } = await supabase
    .from('mots')
    .select('id')
    .eq('mot_normalized', normalized)
    .eq('categorie_id', categorieId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data !== null;
}

export async function downloadDictionary(): Promise<void> {
  const { data: categories, error: catError } = await supabase
    .from('categories')
    .select('*');

  if (catError) {
    throw new Error(catError.message);
  }

  const { data: mots, error: motsError } = await supabase
    .from('mots')
    .select('*');

  if (motsError) {
    throw new Error(motsError.message);
  }

  const dictionaryData: DictionaryData = {
    categories: categories || [],
    mots: mots || [],
  };

  await saveDictionaryToFile(dictionaryData);
}

export async function saveGame(
  lettre: string,
  score: number,
  reponses: Array<{
    categorie_id: number;
    mot_saisi: string;
    est_valide: boolean;
    points: number;
  }>
): Promise<string> {
  const { data: partie, error: partieError } = await supabase
    .from('parties')
    .insert({ lettre, score })
    .select()
    .single();

  if (partieError) {
    throw new Error(partieError.message);
  }

  const reponsesWithPartieId = reponses.map(r => ({
    ...r,
    partie_id: partie.id,
  }));

  const { error: reponsesError } = await supabase
    .from('reponses')
    .insert(reponsesWithPartieId);

  if (reponsesError) {
    throw new Error(reponsesError.message);
  }

  return partie.id;
}
