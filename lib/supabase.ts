// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const supabaseUrl = Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Categorie = {
  id: number;
  nom: string;
  created_at: string;
};

export type Mot = {
  id: number;
  mot: string;
  mot_normalized: string;
  categorie_id: number;
  created_at: string;
};

export type Partie = {
  id: string;
  lettre: string;
  score: number;
  date_jeu: string;
};

export type Reponse = {
  id: string;
  partie_id: string;
  categorie_id: number;
  mot_saisi: string;
  est_valide: boolean;
  points: number;
};
