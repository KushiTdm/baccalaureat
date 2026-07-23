// store/gameStore.ts
import { create } from 'zustand';
import { Categorie } from '../lib/supabase';

export type GameAnswer = {
  categorieId: number;
  categorieName: string;
  word: string;
};

export type GameResult = {
  categorieId: number;
  categorieName: string;
  word: string;
  isValid: boolean;
  points: number;
  needsManualValidation?: boolean;
  manualValidationResult?: boolean | null;
};

export type RoundHistory = {
  roundNumber: number;
  letter: string;
  myScore: number;
  opponentScore: number;
  myValidWords: number;
  opponentValidWords: number;
};

// Mots validés par accord mutuel pendant la partie (mode Bluetooth, pas de
// table serveur) + verdict du gate IA de fin de manche. aiResult: null tant
// qu'aucune clé Gemini n'a permis de trancher (Partie 7).
export type DictionaryHistoryEntry = {
  word: string;
  categorieName: string;
  aiResult: boolean | null;
};

type GameState = {
  currentLetter: string | null;
  categories: Categorie[];
  answers: GameAnswer[];
  results: GameResult[] | null;
  score: number;
  isPlaying: boolean;
  timeRemaining: number;
  // Horloge de manche : timestamp (ms, horloge locale) de fin de manche.
  // Le Timer recalcule le temps restant à partir de cette valeur, ce qui le
  // rend insensible aux re-renders et permet la resynchro serveur (catch-up).
  roundEndsAt: number | null;
  roundDurationSec: number;

  // Multiplayer state
  isMultiplayer: boolean;
  isHost: boolean;
  opponentName: string | null;
  opponentResults: GameResult[] | null;
  opponentScore: number;
  // Bonus/pénalité de STOP (vérité serveur, game_round_scores.stop_bonus /
  // penalty_applied) — celui des deux joueurs qui a crié STOP peut être
  // n'importe lequel des deux, d'où un champ pour chaque côté plutôt qu'un
  // seul "mien".
  bonusApplied: boolean;
  penaltyApplied: boolean;
  opponentBonusApplied: boolean;
  opponentPenaltyApplied: boolean;
  // Score CUMULÉ réel (game_room_players.score, vérité serveur), tenu à jour
  // en direct par onScoreUpdated et par tout refetch de manche — jamais une
  // somme locale de roundHistory, qui peut diverger si l'historique a été
  // committé avant qu'une validation manuelle tardive ne mette à jour le
  // score de sa manche (bug identifié : "Score total" affiché faux en cours
  // de partie malgré un serveur parfaitement cohérent). `serverTotalsReady`
  // distingue "pas encore reçu" de "vraiment à 0".
  serverTotalScore: number;
  serverOpponentTotalScore: number;
  serverTotalsReady: boolean;

  // Round system state
  currentRound: number;
  roundHistory: RoundHistory[];
  stoppedEarly: boolean; // Si le joueur a validé avant la fin
  endGameRequested: boolean; // Si une demande de fin a été envoyée
  endGameRequestReceived: boolean; // Si une demande de fin a été reçue

  // Mode Bluetooth uniquement (pas de table serveur) : historique des mots
  // validés par accord mutuel sur TOUTE la partie (survit à la navigation
  // manche par manche, contrairement à un state local d'écran).
  dictionaryHistory: DictionaryHistoryEntry[];
  addDictionaryHistoryEntries: (entries: { word: string; categorieName: string }[]) => void;
  setDictionaryHistoryResult: (word: string, categorieName: string, aiResult: boolean) => void;

  setLetter: (letter: string) => void;
  setCategories: (categories: Categorie[]) => void;
  setAnswer: (categorieId: number, word: string) => void;
  setResults: (results: GameResult[]) => void;
  setScore: (score: number) => void;
  setIsHost: (isHost: boolean) => void;
  startGame: (letter: string, categories: Categorie[], durationSec?: number) => void;
  startMultiplayerGame: (letter: string, categories: Categorie[], isHost: boolean, opponentName: string) => void;
  setMultiplayerResults: (
    myResults: GameResult[],
    myScore: number,
    stoppedEarly?: boolean,
    bonusApplied?: boolean,
    penaltyApplied?: boolean
  ) => void;
  setOpponentResults: (
    results: GameResult[],
    score: number,
    bonusApplied?: boolean,
    penaltyApplied?: boolean
  ) => void;
  endGame: () => void;
  resetGame: () => void;
  setTimeRemaining: (time: number | ((prev: number) => number)) => void;
  // Synchronise l'horloge de manche sur la durée/temps écoulé serveur
  syncRoundClock: (durationSec: number, elapsedSec?: number) => void;

  // Round system actions
  startNewRound: (letter: string, roundNumber?: number) => void;
  addRoundToHistory: (round: RoundHistory) => void;
  setStoppedEarly: (stopped: boolean) => void;
  setEndGameRequested: (requested: boolean) => void;
  setEndGameRequestReceived: (received: boolean) => void;

  // Validation manuelle par accord mutuel (mot absent du dictionnaire) :
  // corrige un résultat déjà soumis et recalcule le score correspondant.
  patchOwnResult: (categorieId: number, updates: Partial<GameResult>) => void;
  patchOpponentResult: (categorieId: number, updates: Partial<GameResult>) => void;

  setServerTotals: (myTotal: number, opponentTotal: number) => void;
};

export const useGameStore = create<GameState>((set) => ({
  currentLetter: null,
  categories: [],
  answers: [],
  results: null,
  score: 0,
  isPlaying: false,
  timeRemaining: 120,
  roundEndsAt: null,
  roundDurationSec: 120,

  // Multiplayer state
  isMultiplayer: false,
  isHost: false,
  opponentName: null,
  opponentResults: null,
  opponentScore: 0,
  bonusApplied: false,
  penaltyApplied: false,
  opponentBonusApplied: false,
  opponentPenaltyApplied: false,
  serverTotalScore: 0,
  serverOpponentTotalScore: 0,
  serverTotalsReady: false,

  // Round system state
  currentRound: 1,
  roundHistory: [],
  stoppedEarly: false,
  endGameRequested: false,
  endGameRequestReceived: false,
  dictionaryHistory: [],

  setLetter: (letter) => set({ currentLetter: letter }),

  setCategories: (categories) => set({ categories }),

  setAnswer: (categorieId, word) =>
    set((state) => {
      const existingIndex = state.answers.findIndex(
        (a) => a.categorieId === categorieId
      );
      const category = state.categories.find((c) => c.id === categorieId);

      const newAnswer: GameAnswer = {
        categorieId,
        categorieName: category?.nom || '',
        word,
      };

      if (existingIndex >= 0) {
        const newAnswers = [...state.answers];
        newAnswers[existingIndex] = newAnswer;
        return { answers: newAnswers };
      } else {
        return { answers: [...state.answers, newAnswer] };
      }
    }),

  setResults: (results) => set({ results }),

  setScore: (score) => set({ score }),

  setIsHost: (isHost) => set({ isHost }),

  startGame: (letter, categories, durationSec = 120) =>
    set({
      currentLetter: letter,
      categories,
      answers: [],
      results: null,
      score: 0,
      isPlaying: true,
      timeRemaining: durationSec,
      roundEndsAt: Date.now() + durationSec * 1000,
      roundDurationSec: durationSec,
      isMultiplayer: false,
      isHost: false,
      opponentName: null,
      opponentResults: null,
      opponentScore: 0,
      bonusApplied: false,
      penaltyApplied: false,
      opponentBonusApplied: false,
      opponentPenaltyApplied: false,
      serverTotalScore: 0,
      serverOpponentTotalScore: 0,
      serverTotalsReady: false,
      currentRound: 1,
      roundHistory: [],
      stoppedEarly: false,
      endGameRequested: false,
      endGameRequestReceived: false,
      dictionaryHistory: [],
    }),

  // N'appeler qu'au tout DÉBUT d'une partie multijoueur (pas entre deux
  // manches : ça remettrait currentRound à 1 et viderait roundHistory —
  // voir app/multiplayer-results.tsx, startNextRound() utilise startNewRound()
  // seul pour passer à la manche suivante sans perdre l'historique).
  startMultiplayerGame: (letter, categories, isHost, opponentName) =>
    set({
      currentLetter: letter,
      categories,
      answers: [],
      results: null,
      score: 0,
      isPlaying: true,
      timeRemaining: 120,
      roundEndsAt: Date.now() + 120_000,
      roundDurationSec: 120,
      isMultiplayer: true,
      isHost,
      opponentName,
      opponentResults: null,
      opponentScore: 0,
      bonusApplied: false,
      penaltyApplied: false,
      opponentBonusApplied: false,
      opponentPenaltyApplied: false,
      serverTotalScore: 0,
      serverOpponentTotalScore: 0,
      serverTotalsReady: false,
      currentRound: 1,
      roundHistory: [],
      stoppedEarly: false,
      endGameRequested: false,
      endGameRequestReceived: false,
      dictionaryHistory: [],
    }),

  setMultiplayerResults: (myResults, myScore, stoppedEarly = false, bonusApplied = false, penaltyApplied = false) =>
    set({
      results: myResults,
      score: myScore,
      stoppedEarly,
      bonusApplied,
      penaltyApplied,
    }),

  setOpponentResults: (results, score, bonusApplied = false, penaltyApplied = false) =>
    set({
      opponentResults: results,
      opponentScore: score,
      opponentBonusApplied: bonusApplied,
      opponentPenaltyApplied: penaltyApplied,
    }),

  setServerTotals: (myTotal, opponentTotal) =>
    set({
      serverTotalScore: myTotal,
      serverOpponentTotalScore: opponentTotal,
      serverTotalsReady: true,
    }),

  endGame: () => set({ isPlaying: false, roundEndsAt: null }),

  resetGame: () =>
    set({
      currentLetter: null,
      categories: [],
      answers: [],
      results: null,
      score: 0,
      isPlaying: false,
      timeRemaining: 120,
      roundEndsAt: null,
      isMultiplayer: false,
      isHost: false,
      opponentName: null,
      opponentResults: null,
      opponentScore: 0,
      bonusApplied: false,
      penaltyApplied: false,
      opponentBonusApplied: false,
      opponentPenaltyApplied: false,
      serverTotalScore: 0,
      serverOpponentTotalScore: 0,
      serverTotalsReady: false,
      currentRound: 1,
      roundHistory: [],
      stoppedEarly: false,
      endGameRequested: false,
      endGameRequestReceived: false,
      dictionaryHistory: [],
    }),

  setTimeRemaining: (timeOrFn) =>
    set((state) => ({
      timeRemaining: typeof timeOrFn === 'function' ? timeOrFn(state.timeRemaining) : timeOrFn
    })),

  syncRoundClock: (durationSec, elapsedSec = 0) => {
    const remaining = Math.max(0, durationSec - elapsedSec);
    set({
      timeRemaining: Math.ceil(remaining),
      roundEndsAt: Date.now() + remaining * 1000,
      roundDurationSec: durationSec,
    });
  },

  // Round system actions
  startNewRound: (letter, roundNumber) =>
    set((state) => ({
      currentLetter: letter,
      // Le numéro de manche serveur fait foi (évite la dérive si un client
      // a raté un événement) ; fallback : incrément local.
      currentRound: roundNumber ?? state.currentRound + 1,
      answers: [],
      results: null,
      score: 0,
      isPlaying: true,
      timeRemaining: 120,
      roundEndsAt: Date.now() + 120_000,
      roundDurationSec: 120,
      stoppedEarly: false,
      endGameRequested: false,
      endGameRequestReceived: false,
      opponentResults: null,
      opponentScore: 0,
      bonusApplied: false,
      penaltyApplied: false,
      opponentBonusApplied: false,
      opponentPenaltyApplied: false,
    })),

  addRoundToHistory: (round) =>
    set((state) => ({
      roundHistory: [...state.roundHistory, round],
    })),

  addDictionaryHistoryEntries: (entries) =>
    set((state) => ({
      dictionaryHistory: [...state.dictionaryHistory, ...entries.map((e) => ({ ...e, aiResult: null }))],
    })),

  setDictionaryHistoryResult: (word, categorieName, aiResult) =>
    set((state) => ({
      dictionaryHistory: state.dictionaryHistory.map((h) =>
        h.word === word && h.categorieName === categorieName && h.aiResult === null ? { ...h, aiResult } : h
      ),
    })),

  setStoppedEarly: (stopped) => set({ stoppedEarly: stopped }),

  setEndGameRequested: (requested) => set({ endGameRequested: requested }),

  setEndGameRequestReceived: (received) => set({ endGameRequestReceived: received }),

  patchOwnResult: (categorieId, updates) =>
    set((state) => {
      if (!state.results) return {};
      const results = state.results.map((r) =>
        r.categorieId === categorieId ? { ...r, ...updates } : r
      );
      return { results, score: results.reduce((sum, r) => sum + r.points, 0) };
    }),

  patchOpponentResult: (categorieId, updates) =>
    set((state) => {
      if (!state.opponentResults) return {};
      const opponentResults = state.opponentResults.map((r) =>
        r.categorieId === categorieId ? { ...r, ...updates } : r
      );
      return {
        opponentResults,
        opponentScore: opponentResults.reduce((sum, r) => sum + r.points, 0),
      };
    }),
}));