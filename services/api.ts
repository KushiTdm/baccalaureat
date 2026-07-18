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
  try {
    console.log('📥 Début du téléchargement du dictionnaire...');
    
    // 1. Télécharger les catégories
    const { data: categories, error: catError } = await supabase
      .from('categories')
      .select('*')
      .order('id');

    if (catError) {
      console.error('❌ Erreur catégories:', catError);
      throw new Error('Impossible de télécharger les catégories: ' + catError.message);
    }

    if (!categories || categories.length === 0) {
      throw new Error('Aucune catégorie trouvée dans la base de données');
    }

    console.log(`✅ ${categories.length} catégories téléchargées`);

    // 2. Compter le nombre total de mots
    const { count, error: countError } = await supabase
      .from('mots')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ Erreur comptage:', countError);
      throw new Error('Impossible de compter les mots');
    }

    console.log(`📊 ${count || 0} mots à télécharger`);

    // 3. Télécharger les mots par lots de 1000
    const BATCH_SIZE = 1000;
    const totalBatches = Math.ceil((count || 0) / BATCH_SIZE);
    let allMots: any[] = [];

    for (let i = 0; i < totalBatches; i++) {
      const from = i * BATCH_SIZE;
      const to = from + BATCH_SIZE - 1;
      
      console.log(`📦 Téléchargement du lot ${i + 1}/${totalBatches} (${from}-${to})...`);

      const { data: motsBatch, error: motsError } = await supabase
        .from('mots')
        .select('*')
        .range(from, to)
        .order('id');

      if (motsError) {
        console.error(`❌ Erreur lot ${i + 1}:`, motsError);
        throw new Error(`Erreur lors du téléchargement du lot ${i + 1}: ` + motsError.message);
      }

      if (motsBatch) {
        allMots = [...allMots, ...motsBatch];
        console.log(`✅ Lot ${i + 1}/${totalBatches} téléchargé (${motsBatch.length} mots)`);
      }

      // Petite pause entre les lots pour éviter de surcharger
      if (i < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`✅ Total: ${allMots.length} mots téléchargés`);

    // 4. Créer l'objet dictionnaire
    const dictionaryData: DictionaryData = {
      categories: categories,
      mots: allMots,
    };

    // 5. Sauvegarder
    console.log('💾 Sauvegarde du dictionnaire...');
    await saveDictionaryToFile(dictionaryData);
    console.log('✅ Dictionnaire sauvegardé avec succès');

  } catch (error: any) {
    console.error('❌ Erreur globale:', error);
    
    // Message d'erreur plus précis
    if (error.message?.includes('fetch')) {
      throw new Error('Problème de connexion internet. Vérifiez votre connexion et réessayez.');
    } else if (error.message?.includes('timeout')) {
      throw new Error('Le téléchargement a pris trop de temps. Réessayez avec une meilleure connexion.');
    } else {
      throw new Error(error.message || 'Erreur inconnue lors du téléchargement');
    }
  }
}

export async function saveGame(
  lettre: string,
  score: number,
  reponses: Array<{
    categorie_id: number;
    mot_saisi: string;
    est_valide: boolean;
    points: number;
  }>,
  userId?: string
): Promise<string> {
  // user_id est optionnel : si la migration stats-migration.sql n'est pas
  // encore passée, on retente sans la colonne plutôt que d'échouer.
  let { data: partie, error: partieError } = await supabase
    .from('parties')
    .insert(userId ? { lettre, score, user_id: userId } : { lettre, score })
    .select()
    .single();

  if (partieError && userId) {
    ({ data: partie, error: partieError } = await supabase
      .from('parties')
      .insert({ lettre, score })
      .select()
      .single());
  }

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
