// services/user.ts
import { supabase } from '../lib/supabase';

export interface User {
  id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
  last_login_at: string | null;
  is_online: boolean;
  total_games_played: number;
  total_games_won: number;
  total_games_lost: number;
  total_games_draw: number;
  total_points: number;
  total_valid_words: number;
  win_rate: number;
  best_round_score: number;
  best_game_score: number;
  elo_rating: number;
  rank_position: number | null;
}

export interface GameHistory {
  id: string;
  player_id: string;
  opponent_id: string;
  result: 'win' | 'loss' | 'draw';
  my_score: number;
  opponent_score: number;
  rounds_played: number;
  total_valid_words: number;
  best_round_score: number;
  elo_before: number;
  elo_after: number;
  elo_change: number;
  played_at: string;
  duration_seconds: number | null;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  avatar_url: string | null;
  elo_rating: number;
  rank_position: number;
  total_games_played: number;
  total_games_won: number;
  win_rate: number;
  total_points: number;
  best_game_score: number;
  is_online: boolean;
}

class UserService {
  // ===== AUTHENTIFICATION =====
  
  async signUp(username: string, email: string, password: string): Promise<User> {
    // 1. Créer le compte auth Supabase
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError || !authData.user) {
      throw new Error(authError?.message || 'Erreur lors de l\'inscription');
    }

    // 2. Créer le profil utilisateur
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        username,
        email,
      })
      .select()
      .single();

    if (userError || !userData) {
      throw new Error('Erreur lors de la création du profil');
    }

    return userData;
  }

  async signIn(email: string, password: string): Promise<User> {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      throw new Error(authError?.message || 'Identifiants incorrects');
    }

    // Mettre à jour last_login et is_online
    await supabase
      .from('users')
      .update({
        last_login_at: new Date().toISOString(),
        is_online: true,
      })
      .eq('id', authData.user.id);

    const user = await this.getCurrentUser();
    if (!user) throw new Error('Utilisateur introuvable');

    return user;
  }

  async signOut(): Promise<void> {
    const user = await supabase.auth.getUser();
    
    if (user.data.user) {
      await supabase
        .from('users')
        .update({ is_online: false })
        .eq('id', user.data.user.id);
    }

    await supabase.auth.signOut();
  }

  async getCurrentUser(): Promise<User | null> {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    
    if (!authUser) return null;

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (error) return null;
    return data;
  }

  // ===== PROFIL =====

  async updateProfile(userId: string, updates: Partial<User>): Promise<User> {
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error || !data) {
      throw new Error('Erreur lors de la mise à jour du profil');
    }

    return data;
  }

  async uploadAvatar(userId: string, file: File): Promise<string> {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file);

    if (uploadError) {
      throw new Error('Erreur lors du téléchargement de l\'avatar');
    }

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    await this.updateProfile(userId, { avatar_url: publicUrl });

    return publicUrl;
  }

  // ===== STATISTIQUES =====

  async getUserStats(userId: string): Promise<User> {
    const { data, error } = await supabase
      .from('player_stats')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new Error('Impossible de charger les statistiques');
    }

    return data;
  }

  async updateStatsAfterGame(
    userId: string,
    opponentId: string,
    result: 'win' | 'loss' | 'draw',
    myScore: number,
    opponentScore: number,
    roundsPlayed: number,
    validWords: number,
    bestRoundScore: number
  ): Promise<void> {
    // 1. Récupérer les stats actuelles
    const user = await this.getUserStats(userId);
    const opponent = await this.getUserStats(opponentId);

    // 2. Calculer le changement ELO
    const { data: eloChange } = await supabase.rpc('calculate_elo_change', {
      player_elo: user.elo_rating,
      opponent_elo: opponent.elo_rating,
      result: result,
    });

    const newElo = user.elo_rating + (eloChange || 0);

    // 3. Mettre à jour les stats du joueur
    const updates: Partial<User> = {
      total_games_played: user.total_games_played + 1,
      total_games_won: result === 'win' ? user.total_games_won + 1 : user.total_games_won,
      total_games_lost: result === 'loss' ? user.total_games_lost + 1 : user.total_games_lost,
      total_games_draw: result === 'draw' ? user.total_games_draw + 1 : user.total_games_draw,
      total_points: user.total_points + myScore,
      total_valid_words: user.total_valid_words + validWords,
      best_round_score: Math.max(user.best_round_score, bestRoundScore),
      best_game_score: Math.max(user.best_game_score, myScore),
      elo_rating: newElo,
    };

    await this.updateProfile(userId, updates);

    // 4. Enregistrer dans l'historique
    await supabase.from('game_history').insert({
      player_id: userId,
      opponent_id: opponentId,
      result,
      my_score: myScore,
      opponent_score: opponentScore,
      rounds_played: roundsPlayed,
      total_valid_words: validWords,
      best_round_score: bestRoundScore,
      elo_before: user.elo_rating,
      elo_after: newElo,
      elo_change: eloChange || 0,
    });
  }

  // ===== CLASSEMENT =====

  async getLeaderboard(limit: number = 100): Promise<LeaderboardEntry[]> {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('*')
      .limit(limit);

    if (error) {
      throw new Error('Impossible de charger le classement');
    }

    return data || [];
  }

  async searchUsers(query: string): Promise<User[]> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .ilike('username', `%${query}%`)
      .limit(20);

    if (error) {
      throw new Error('Erreur lors de la recherche');
    }

    return data || [];
  }

  // ===== HISTORIQUE =====

  async getGameHistory(userId: string, limit: number = 50): Promise<GameHistory[]> {
    const { data, error } = await supabase
      .from('game_history')
      .select('*')
      .eq('player_id', userId)
      .order('played_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error('Impossible de charger l\'historique');
    }

    return data || [];
  }

  // ===== ACHIEVEMENTS =====

  async checkAndUnlockAchievements(userId: string): Promise<void> {
    const user = await this.getUserStats(userId);

    // Récupérer tous les achievements
    const { data: achievements } = await supabase
      .from('achievements')
      .select('*');

    if (!achievements) return;

    // Vérifier chaque achievement
    for (const achievement of achievements) {
      let hasAchievement = false;

      switch (achievement.requirement_type) {
        case 'games_won':
          hasAchievement = user.total_games_won >= achievement.requirement_value;
          break;
        case 'total_games_played':
          hasAchievement = user.total_games_played >= achievement.requirement_value;
          break;
        case 'total_points':
          hasAchievement = user.total_points >= achievement.requirement_value;
          break;
        case 'total_valid_words':
          hasAchievement = user.total_valid_words >= achievement.requirement_value;
          break;
        case 'elo_rating':
          hasAchievement = user.elo_rating >= achievement.requirement_value;
          break;
      }

      if (hasAchievement) {
        // Vérifier si déjà débloqué
        const { data: existing } = await supabase
          .from('user_achievements')
          .select('id')
          .eq('user_id', userId)
          .eq('achievement_id', achievement.id)
          .single();

        if (!existing) {
          // Débloquer l'achievement
          await supabase.from('user_achievements').insert({
            user_id: userId,
            achievement_id: achievement.id,
          });
        }
      }
    }
  }

  async getUserAchievements(userId: string) {
    const { data, error } = await supabase
      .from('user_achievements')
      .select(`
        *,
        achievement:achievements(*)
      `)
      .eq('user_id', userId)
      .order('unlocked_at', { ascending: false });

    if (error) {
      throw new Error('Impossible de charger les achievements');
    }

    return data || [];
  }
}

export const userService = new UserService();