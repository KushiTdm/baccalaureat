// services/stats.ts - Enregistrement des parties et des statistiques joueur.
// Tout est "fire-and-forget" : une erreur (migration SQL pas encore passée,
// hors ligne, adversaire sans compte) ne doit JAMAIS bloquer le jeu.
import { saveGame } from './api';
import { userService } from './user';
import { onlineService } from './online';
import { GameResult } from '../store/gameStore';

/**
 * Sauvegarde une partie solo terminée (table `parties` + `reponses`).
 */
export async function recordSoloGame(
  userId: string | undefined,
  lettre: string,
  score: number,
  results: GameResult[]
): Promise<void> {
  try {
    const reponses = results.map((r) => ({
      categorie_id: r.categorieId,
      mot_saisi: r.word,
      est_valide: r.isValid,
      points: r.points,
    }));
    await saveGame(lettre, score, reponses, userId);
  } catch (error) {
    console.warn('📊 Sauvegarde partie solo échouée:', error);
  }
}

/**
 * Met à jour les stats (victoires, ELO, game_history) après une partie en
 * ligne. Chaque client enregistre SES stats. Sans user_id adverse (migration
 * absente, invité anonyme), on abandonne silencieusement.
 */
export async function recordOnlineGame(params: {
  userId: string | undefined;
  myPlayerId: string | null;
  myScore: number;
  opponentScore: number;
  roundsPlayed: number;
  validWords: number;
  bestRoundScore: number;
}): Promise<void> {
  const { userId, myPlayerId, myScore, opponentScore, roundsPlayed, validWords, bestRoundScore } = params;
  if (!userId || !myPlayerId) return;

  try {
    const opponentUserId = await onlineService.getOpponentUserId(myPlayerId);
    if (!opponentUserId) {
      console.warn('📊 Adversaire sans compte : stats ELO non enregistrées');
      return;
    }

    const result: 'win' | 'loss' | 'draw' =
      myScore > opponentScore ? 'win' : myScore < opponentScore ? 'loss' : 'draw';

    await userService.updateStatsAfterGame(
      userId,
      opponentUserId,
      result,
      myScore,
      opponentScore,
      roundsPlayed,
      validWords,
      bestRoundScore
    );
  } catch (error) {
    console.warn('📊 Mise à jour des stats en ligne échouée:', error);
  }
}

/**
 * Historique des parties solo d'un joueur (écran profil).
 */
export type SoloGameSummary = {
  id: string;
  lettre: string;
  score: number;
  date_jeu: string;
};

export async function getSoloHistory(userId: string, limit = 10): Promise<SoloGameSummary[]> {
  try {
    const { supabase } = await import('../lib/supabase');
    const { data, error } = await supabase
      .from('parties')
      .select('id, lettre, score, date_jeu')
      .eq('user_id', userId)
      .order('date_jeu', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}
