// services/auth.ts
import { supabase } from '../lib/supabase';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import Constants from 'expo-constants';

export interface AuthUser {
  id: string;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  device_id: string | null;
  auth_type: 'device' | 'email';
  has_set_username: boolean;
  is_online: boolean;
  created_at: string;
  
  // Stats
  total_games_played: number;
  total_games_won: number;
  total_games_lost: number;
  total_games_draw: number;
  total_points: number;
  elo_rating: number;
  rank_position: number | null;
  win_rate: number;

  // Stats détaillées (colonnes de stats-migration.sql, optionnelles)
  best_round_score?: number;
  best_game_score?: number;
  total_valid_words?: number;

  // Utilisateur local hors ligne (jamais synchronisé avec Supabase)
  is_local?: boolean;
}

const STORAGE_KEY = '@petit_bac:device_id';
const USER_STORAGE_KEY = '@petit_bac:user';
// Clé séparée de USER_STORAGE_KEY : le user local ne doit jamais
// écraser le cache d'un vrai compte Supabase.
const LOCAL_USER_STORAGE_KEY = '@petit_bac:local_user';

class AuthService {
  private currentDeviceId: string | null = null;

  // ===== GÉNÉRATION ET RÉCUPÉRATION DU DEVICE ID =====
  
  async getDeviceId(): Promise<string> {
    if (this.currentDeviceId) {
      return this.currentDeviceId;
    }

    const storedId = await AsyncStorage.getItem(STORAGE_KEY);
    if (storedId) {
      this.currentDeviceId = storedId;
      return storedId;
    }

    let deviceInfo = '';

    if (Platform.OS === 'android') {
      const androidId = await Application.getAndroidId();
      deviceInfo = androidId || '';
    } else if (Platform.OS === 'ios') {
      const iosId = await Application.getIosIdForVendorAsync();
      deviceInfo = iosId || '';
    } else {
      deviceInfo = Constants.sessionId || '';
    }

    const additionalInfo = [
      Platform.OS,
      Constants.deviceName,
      Constants.installationId,
    ].join('-');

    const combinedInfo = `${deviceInfo}-${additionalInfo}`;
    const hashedId = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      combinedInfo
    );

    await AsyncStorage.setItem(STORAGE_KEY, hashedId);
    this.currentDeviceId = hashedId;

    return hashedId;
  }

  async resetDeviceId(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
    await AsyncStorage.removeItem(USER_STORAGE_KEY);
    this.currentDeviceId = null;
  }

  // ===== AUTHENTIFICATION PAR DEVICE =====

  async loginWithDevice(): Promise<AuthUser> {
  try {
    console.log('🔐 Tentative de connexion...');
    const deviceId = await this.getDeviceId();
    console.log('📱 Device ID COMPLET:', deviceId);
    console.log('📏 Longueur device ID:', deviceId.length);

    // Vérifier la connexion à Supabase
    const { error: healthError } = await supabase.from('categories').select('id').limit(1);
    if (healthError && healthError.message.includes('Failed to fetch')) {
      throw new Error('Impossible de se connecter au serveur. Vérifiez votre connexion internet.');
    }

    // Chercher l'utilisateur existant
    const { data: existingUsers, error: fetchError } = await supabase
      .rpc('get_user_by_device', {
        p_device_id: deviceId,
      });

    if (fetchError) {
      console.error('❌ Erreur lors de la recherche:', fetchError);
      // Message d'erreur plus détaillé
      if (fetchError.message.includes('function') && fetchError.message.includes('does not exist')) {
        throw new Error('Les fonctions du serveur ne sont pas installées. Veuillez exécuter le script SQL database/auth-device-fix.sql dans Supabase.');
      }
      if (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('NetworkError')) {
        throw new Error('Problème de connexion réseau. Vérifiez votre connexion internet.');
      }
      throw new Error(`Erreur serveur: ${fetchError.message}`);
    }

    // existingUsers peut être un array ou un objet selon la version de PostgREST
    const existingUser = Array.isArray(existingUsers) 
      ? (existingUsers.length > 0 ? existingUsers[0] : null)
      : existingUsers;

    if (existingUser && existingUser.id) {
      console.log('✅ Utilisateur existant trouvé:', existingUser.username || 'Sans pseudo');
      await this.saveUserLocally(existingUser);
      return existingUser;
    }

    // Créer un nouvel utilisateur
    console.log('🆕 Création d\'un nouveau compte...');
    const { data: newUsers, error: createError } = await supabase
      .rpc('create_user_with_device', {
        p_device_id: deviceId,
        p_username: null,
      });

    if (createError) {
      console.error('❌ Erreur lors de la création:', createError);
      throw new Error(createError.message || 'Impossible de créer le compte');
    }

    const newUser = Array.isArray(newUsers)
      ? (newUsers.length > 0 ? newUsers[0] : null)
      : newUsers;

    if (!newUser || !newUser.id) {
      throw new Error('Aucun utilisateur retourné après création');
    }

    console.log('✅ Nouveau compte créé:', newUser.id);
    await this.saveUserLocally(newUser);
    return newUser;

  } catch (error: any) {
    console.error('❌ Erreur loginWithDevice:', error);
    throw new Error(error.message || 'Erreur lors de la connexion');
  }
}

  /**
   * Définir ou modifier le pseudo - VERSION CORRIGÉE AVEC RPC
   */
  async setUsername(username: string): Promise<AuthUser> {
  try {
    console.log('📝 Mise à jour du pseudo:', username);
    
    if (!username || username.trim().length < 3) {
      throw new Error('Le pseudo doit contenir au moins 3 caractères');
    }

    if (username.length > 20) {
      throw new Error('Le pseudo ne peut pas dépasser 20 caractères');
    }

    const deviceId = await this.getDeviceId();
    console.log('🔍 Device ID COMPLET pour update:', deviceId);
    console.log('📏 Longueur:', deviceId.length);

    const { data: updatedUsers, error } = await supabase
      .rpc('set_username_for_device', {
        p_device_id: deviceId,
        p_username: username.trim(),
      });

    if (error) {
      console.error('❌ Erreur RPC:', error);
      throw new Error(error.message);
    }

    const updatedUser = updatedUsers && updatedUsers.length > 0 ? updatedUsers[0] : null;

    if (!updatedUser) {
      throw new Error('Aucune donnée retournée après la mise à jour');
    }

    console.log('✅ Pseudo mis à jour:', updatedUser.username);
    await this.saveUserLocally(updatedUser);

    return updatedUser;
  } catch (error: any) {
    console.error('❌ Erreur setUsername:', error);
    throw error;
  }
}

  async getCurrentUser(): Promise<AuthUser | null> {
    try {
      // 1. Essayer de récupérer depuis le cache local
      const cachedUser = await this.getUserFromCache();
      if (cachedUser) {
        return cachedUser;
      }

      // 2. Récupérer depuis la base de données avec RPC
      const deviceId = await this.getDeviceId();
      const { data, error } = await supabase
        .rpc('get_user_by_device', {
          p_device_id: deviceId,
        });

      if (error || !data) {
        return null;
      }

      // Stocker localement
      await this.saveUserLocally(data);

      return data;
    } catch (error) {
      console.error('❌ Erreur getCurrentUser:', error);
      return null;
    }
  }

  async logout(): Promise<void> {
    try {
      const deviceId = await this.getDeviceId();
      
      // UPDATE direct fonctionne maintenant car RLS est désactivé
      await supabase
        .from('users')
        .update({ is_online: false })
        .eq('device_id', deviceId);

      await AsyncStorage.removeItem(USER_STORAGE_KEY);
    } catch (error) {
      console.error('❌ Erreur logout:', error);
    }
  }

  // ===== AUTHENTIFICATION PAR EMAIL =====

  async linkEmailToAccount(email: string, password: string): Promise<AuthUser> {
    try {
      const deviceId = await this.getDeviceId();

      const { data: currentUser } = await supabase
        .rpc('get_user_by_device', {
          p_device_id: deviceId,
        });

      if (!currentUser) {
        throw new Error('Utilisateur non trouvé');
      }

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) {
        throw new Error(authError.message);
      }

      const passwordHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        password
      );

      const { data: updatedUser, error } = await supabase
        .rpc('link_email_to_device', {
          p_user_id: currentUser.id,
          p_email: email,
          p_password_hash: passwordHash,
        });

      if (error) {
        throw new Error('Impossible de lier l\'email');
      }

      await this.saveUserLocally(updatedUser);

      return updatedUser;
    } catch (error: any) {
      console.error('❌ Erreur linkEmailToAccount:', error);
      throw error;
    }
  }

  async loginWithEmail(email: string, password: string): Promise<AuthUser> {
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError || !authData.user) {
        throw new Error('Identifiants incorrects');
      }

      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authData.user.id)
        .single();

      if (error || !user) {
        throw new Error('Utilisateur non trouvé');
      }

      await supabase
        .from('users')
        .update({
          last_login_at: new Date().toISOString(),
          is_online: true,
        })
        .eq('id', user.id);

      await this.saveUserLocally(user);

      return user;
    } catch (error: any) {
      console.error('❌ Erreur loginWithEmail:', error);
      throw error;
    }
  }

  // ===== UTILISATEUR LOCAL (MODE HORS LIGNE) =====

  /**
   * Récupère l'utilisateur local persisté (ou null s'il n'existe pas).
   */
  async getLocalUser(): Promise<AuthUser | null> {
    try {
      const cached = await AsyncStorage.getItem(LOCAL_USER_STORAGE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error('❌ Erreur getLocalUser:', error);
      return null;
    }
  }

  /**
   * Fallback hors ligne : recharge l'utilisateur local persisté ou en crée
   * un nouveau. Utilisé quand le login Supabase échoue (réseau/serveur).
   * Ne touche jamais au cache du vrai compte (USER_STORAGE_KEY).
   */
  async createOrLoadLocalUser(): Promise<AuthUser> {
    const existing = await this.getLocalUser();
    if (existing && existing.id) {
      console.log('📴 Utilisateur local rechargé:', existing.username);
      return existing;
    }

    const localUser: AuthUser = {
      id: `local-${Crypto.randomUUID()}`,
      username: 'Joueur',
      email: null,
      avatar_url: null,
      device_id: null,
      auth_type: 'device',
      has_set_username: true,
      is_online: false,
      created_at: new Date().toISOString(),
      total_games_played: 0,
      total_games_won: 0,
      total_games_lost: 0,
      total_games_draw: 0,
      total_points: 0,
      elo_rating: 0,
      rank_position: null,
      win_rate: 0,
      best_round_score: 0,
      best_game_score: 0,
      total_valid_words: 0,
      is_local: true,
    };

    await this.saveLocalUser(localUser);
    console.log('📴 Utilisateur local créé:', localUser.id);
    return localUser;
  }

  /**
   * Modifie le pseudo de l'utilisateur local (aucun appel Supabase).
   */
  async setLocalUsername(username: string): Promise<AuthUser> {
    if (!username || username.trim().length < 3) {
      throw new Error('Le pseudo doit contenir au moins 3 caractères');
    }
    if (username.length > 20) {
      throw new Error('Le pseudo ne peut pas dépasser 20 caractères');
    }

    const localUser = await this.createOrLoadLocalUser();
    const updatedUser: AuthUser = {
      ...localUser,
      username: username.trim(),
      has_set_username: true,
    };

    await this.saveLocalUser(updatedUser);
    console.log('✅ Pseudo local mis à jour:', updatedUser.username);
    return updatedUser;
  }

  /**
   * Supprime l'utilisateur local (déconnexion en mode hors ligne).
   */
  async clearLocalUser(): Promise<void> {
    try {
      await AsyncStorage.removeItem(LOCAL_USER_STORAGE_KEY);
    } catch (error) {
      console.error('❌ Erreur clearLocalUser:', error);
    }
  }

  private async saveLocalUser(user: AuthUser): Promise<void> {
    try {
      await AsyncStorage.setItem(LOCAL_USER_STORAGE_KEY, JSON.stringify(user));
    } catch (error) {
      console.error('❌ Erreur saveLocalUser:', error);
    }
  }

  // ===== CACHE LOCAL =====

  private async saveUserLocally(user: AuthUser): Promise<void> {
    try {
      await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } catch (error) {
      console.error('❌ Erreur saveUserLocally:', error);
    }
  }

  private async getUserFromCache(): Promise<AuthUser | null> {
    try {
      const cached = await AsyncStorage.getItem(USER_STORAGE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error('❌ Erreur getUserFromCache:', error);
      return null;
    }
  }

  async isFirstLaunch(): Promise<boolean> {
    const user = await this.getCurrentUser();
    return !user || !user.has_set_username;
  }
}

export const authService = new AuthService();