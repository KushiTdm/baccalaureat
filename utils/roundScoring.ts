// utils/roundScoring.ts
//
// Calcul du résultat d'une manche en mode Bluetooth (P2P, sans serveur
// arbitre) : fonction pure appliquée IDENTIQUEMENT sur les deux appareils à
// partir des mêmes données échangées (résultats + qui a stoppé
// manuellement), pour que les deux calculent toujours le même score.
// Réplique côté client la logique de `recomputeRoundScores` côté serveur
// (mode en ligne) : règle des mots dupliqués, pénalité de STOP raté,
// bonus de STOP propre.
import { GameResult } from '../store/gameStore';
import { normalizeWord } from './normalize';

export type RoundOutcome = {
  // Résultats avec points ajustés (mot dupliqué partagé → 1pt au lieu de 2)
  results: GameResult[];
  score: number;
  penaltyApplied: boolean;
  bonusApplied: boolean;
};

type ComputeArgs = {
  myResults: GameResult[];
  opponentResults: GameResult[];
  // J'ai moi-même déclenché la fin de manche en cliquant "Valider mes
  // réponses" (pas en réaction au STOP de l'adversaire, ni au temps écoulé).
  iStoppedManually: boolean;
};

const BASE_POINTS = 2;
const PENALTY = 3;
const BONUS = 3;

export function computeRoundOutcome({ myResults, opponentResults, iStoppedManually }: ComputeArgs): RoundOutcome {
  const adjusted = myResults.map((r) => {
    if (!r.isValid || !r.word) return { ...r, points: 0 };
    const opp = opponentResults.find((o) => o.categorieId === r.categorieId);
    const isDuplicate = !!(opp?.word && opp.isValid && normalizeWord(opp.word) === normalizeWord(r.word));
    return { ...r, points: isDuplicate ? Math.ceil(BASE_POINTS / 2) : BASE_POINTS };
  });

  const rawPoints = adjusted.reduce((sum, r) => sum + r.points, 0);
  const hasInvalidWord = adjusted.some((r) => r.word.trim() !== '' && !r.isValid);
  const myAllFieldsFilled = myResults.length > 0 && myResults.every((r) => r.word.trim() !== '');
  const opponentAllFieldsFilled = opponentResults.length > 0 && opponentResults.every((r) => r.word.trim() !== '');

  const penaltyApplied = iStoppedManually && myAllFieldsFilled && hasInvalidWord;
  const bonusApplied = iStoppedManually && myAllFieldsFilled && !hasInvalidWord && opponentAllFieldsFilled;

  let score = rawPoints;
  if (penaltyApplied) score = Math.max(0, score - PENALTY);
  if (bonusApplied) score += BONUS;

  return { results: adjusted, score, penaltyApplied, bonusApplied };
}
