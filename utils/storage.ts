// utils/storage.ts
import { Platform } from 'react-native';

// Import conditionnel de FileSystem (uniquement sur mobile)
let FileSystem: any = null;
if (Platform.OS !== 'web') {
  FileSystem = require('expo-file-system');
}

const DICTIONARY_FILE_PATH = FileSystem 
  ? `${FileSystem.documentDirectory}dictionary.json`
  : null;

export type DictionaryData = {
  categories: Array<{ id: number; nom: string }>;
  mots: Array<{ id: number; mot: string; mot_normalized: string; categorie_id: number }>;
};

export async function saveDictionaryToFile(data: DictionaryData): Promise<void> {
  try {
    const jsonData = JSON.stringify(data);
    
    if (Platform.OS === 'web') {
      // Sur web, pas de FileSystem disponible
      throw new Error('Le téléchargement hors ligne n\'est pas disponible sur le web');
    } else {
      // Sur mobile, utiliser FileSystem legacy
      await FileSystem.writeAsStringAsync(DICTIONARY_FILE_PATH, jsonData);
    }
  } catch (error) {
    console.error('Error saving dictionary:', error);
    throw error;
  }
}

export async function loadDictionaryFromFile(): Promise<DictionaryData | null> {
  try {
    if (Platform.OS === 'web') {
      return null;
    }
    
    const fileInfo = await FileSystem.getInfoAsync(DICTIONARY_FILE_PATH);
    
    if (!fileInfo.exists) {
      return null;
    }
    
    const jsonData = await FileSystem.readAsStringAsync(DICTIONARY_FILE_PATH);
    return JSON.parse(jsonData);
  } catch (error) {
    console.error('Error loading dictionary:', error);
    return null;
  }
}

export async function isDictionaryDownloaded(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      return false;
    }
    
    const fileInfo = await FileSystem.getInfoAsync(DICTIONARY_FILE_PATH);
    return fileInfo.exists;
  } catch (error) {
    console.error('Error checking dictionary:', error);
    return false;
  }
}

export async function deleteDictionary(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      return;
    }
    
    const fileInfo = await FileSystem.getInfoAsync(DICTIONARY_FILE_PATH);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(DICTIONARY_FILE_PATH);
    }
  } catch (error) {
    console.error('Error deleting dictionary:', error);
    throw error;
  }
}