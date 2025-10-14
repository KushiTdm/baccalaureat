// store/userStore.ts
import { create } from 'zustand';

// Import conditionnel pour éviter les erreurs
let authService: any = null;
let AuthUser: any = null;

try {
  const authModule = require('../services/auth');
  authService = authModule.authService;
  AuthUser = authModule.AuthUser;
} catch (error) {
  console.error('❌ Erreur lors de l\'import de authService:', error);
}

export type { AuthUser } from '../services/auth';

type UserState = {
  user: any | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  needsUsername: boolean;
  
  // Actions
  login: () => Promise<void>;
  setUsername: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  linkEmail: (email: string, password: string) => Promise<void>;
  updateProfile: (updates: any) => void;
};

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  isLoading: false,
  isAuthenticated: false,
  needsUsername: false,

  /**
   * Connexion automatique avec le device
   */
  login: async () => {
    if (!authService) {
      console.error('❌ authService non disponible');
      set({ isLoading: false });
      return;
    }

    try {
      set({ isLoading: true });
      
      console.log('🔐 Tentative de connexion...');
      const user = await authService.loginWithDevice();
      console.log('✅ Connexion réussie:', user.username || 'Sans pseudo');
      
      set({
        user,
        isAuthenticated: true,
        needsUsername: !user.has_set_username,
        isLoading: false,
      });
    } catch (error: any) {
      console.error('❌ Erreur lors de la connexion:', error);
      set({ 
        isLoading: false,
        user: null,
        isAuthenticated: false,
        needsUsername: false,
      });
      throw error;
    }
  },

  /**
   * Définir ou modifier le pseudo
   */
  setUsername: async (username: string) => {
    if (!authService) {
      throw new Error('authService non disponible');
    }

    try {
      console.log('📝 Mise à jour du pseudo:', username);
      const updatedUser = await authService.setUsername(username);
      console.log('✅ Pseudo mis à jour');
      
      set({
        user: updatedUser,
        needsUsername: false,
      });
    } catch (error: any) {
      console.error('❌ Erreur lors de la mise à jour du pseudo:', error);
      throw error;
    }
  },

  /**
   * Déconnexion
   */
  logout: async () => {
    if (!authService) {
      set({
        user: null,
        isAuthenticated: false,
        needsUsername: false,
      });
      return;
    }

    try {
      console.log('👋 Déconnexion...');
      await authService.logout();
      set({
        user: null,
        isAuthenticated: false,
        needsUsername: false,
      });
      console.log('✅ Déconnexion réussie');
    } catch (error: any) {
      console.error('❌ Erreur lors de la déconnexion:', error);
      throw error;
    }
  },

  /**
   * Rafraîchir les données utilisateur
   */
  refreshUser: async () => {
    if (!authService) {
      return;
    }

    try {
      console.log('🔄 Rafraîchissement des données utilisateur...');
      const user = await authService.getCurrentUser();
      
      if (user) {
        set({
          user,
          isAuthenticated: true,
          needsUsername: !user.has_set_username,
        });
        console.log('✅ Données utilisateur rafraîchies');
      } else {
        console.log('⚠️ Aucun utilisateur trouvé');
        set({
          user: null,
          isAuthenticated: false,
          needsUsername: false,
        });
      }
    } catch (error: any) {
      console.error('❌ Erreur lors du rafraîchissement:', error);
    }
  },

  /**
   * Lier un email au compte
   */
  linkEmail: async (email: string, password: string) => {
    if (!authService) {
      throw new Error('authService non disponible');
    }

    try {
      console.log('📧 Liaison email au compte...');
      const updatedUser = await authService.linkEmailToAccount(email, password);
      set({ user: updatedUser });
      console.log('✅ Email lié avec succès');
    } catch (error: any) {
      console.error('❌ Erreur lors de la liaison email:', error);
      throw error;
    }
  },

  /**
   * Mettre à jour le profil localement (optimiste)
   */
  updateProfile: (updates: any) => {
    const currentUser = get().user;
    if (currentUser) {
      console.log('🔄 Mise à jour locale du profil');
      set({
        user: { ...currentUser, ...updates },
      });
    }
  },
}));