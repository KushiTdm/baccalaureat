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
}

const STORAGE_KEY = '@petit_bac:device_id';
const USER_STORAGE_KEY = '@petit_bac:user';

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

    // Chercher l'utilisateur existant
    const { data: existingUsers, error: fetchError } = await supabase
      .rpc('get_user_by_device', {
        p_device_id: deviceId,
      });

    if (fetchError) {
      console.error('❌ Erreur lors de la recherche:', fetchError);
      throw new Error('Impossible de vérifier le compte');
    }

    // existingUsers est un array, prendre le premier
    const existingUser = existingUsers && existingUsers.length > 0 ? existingUsers[0] : null;

    if (existingUser) {
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

    const newUser = newUsers && newUsers.length > 0 ? newUsers[0] : null;

    if (!newUser) {
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