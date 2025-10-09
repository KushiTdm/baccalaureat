// utils/storage.ts
import * as FileSystem from 'expo-file-system';

const DICTIONARY_FILE_PATH = `${FileSystem.documentDirectory}dictionary.json`;

export type DictionaryData = {
  categories: Array<{ id: number; nom: string }>;
  mots: Array<{ id: number; mot: string; mot_normalized: string; categorie_id: number }>;
};

export async function saveDictionaryToFile(data: DictionaryData): Promise<void> {
  try {
    const jsonData = JSON.stringify(data);
    await FileSystem.writeAsStringAsync(DICTIONARY_FILE_PATH, jsonData, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (error) {
    console.error('Error saving dictionary to file:', error);
    throw error;
  }
}

export async function loadDictionaryFromFile(): Promise<DictionaryData | null> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(DICTIONARY_FILE_PATH);
    
    if (!fileInfo.exists) {
      return null;
    }
    
    const jsonData = await FileSystem.readAsStringAsync(DICTIONARY_FILE_PATH, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    
    return JSON.parse(jsonData);
  } catch (error) {
    console.error('Error loading dictionary from file:', error);
    return null;
  }
}

export async function isDictionaryDownloaded(): Promise<boolean> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(DICTIONARY_FILE_PATH);
    return fileInfo.exists;
  } catch (error) {
    console.error('Error checking dictionary file:', error);
    return false;
  }
}

export async function deleteDictionary(): Promise<void> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(DICTIONARY_FILE_PATH);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(DICTIONARY_FILE_PATH);
    }
  } catch (error) {
    console.error('Error deleting dictionary file:', error);
    throw error;
  }
}