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

type GameState = {
  currentLetter: string | null;
  categories: Categorie[];
  answers: GameAnswer[];
  results: GameResult[] | null;
  score: number;
  isPlaying: boolean;
  timeRemaining: number;
  
  // Multiplayer state
  isMultiplayer: boolean;
  isHost: boolean;
  opponentName: string | null;
  opponentResults: GameResult[] | null;
  opponentScore: number;

  // Round system state
  currentRound: number;
  totalScore: number; // Score cumulé sur toutes les manches
  opponentTotalScore: number;
  roundHistory: RoundHistory[];
  stoppedEarly: boolean; // Si le joueur a validé avant la fin
  endGameRequested: boolean; // Si une demande de fin a été envoyée
  endGameRequestReceived: boolean; // Si une demande de fin a été reçue

  setLetter: (letter: string) => void;
  setCategories: (categories: Categorie[]) => void;
  setAnswer: (categorieId: number, word: string) => void;
  setResults: (results: GameResult[]) => void;
  setScore: (score: number) => void;
  startGame: (letter: string, categories: Categorie[]) => void;
  startMultiplayerGame: (letter: string, categories: Categorie[], isHost: boolean, opponentName: string) => void;
  setMultiplayerResults: (myResults: GameResult[], myScore: number, stoppedEarly?: boolean) => void;
  setOpponentResults: (results: GameResult[], score: number) => void;
  endGame: () => void;
  resetGame: () => void;
  setTimeRemaining: (time: number | ((prev: number) => number)) => void;
  
  // Round system actions
  startNewRound: (letter: string) => void;
  addRoundToHistory: (round: RoundHistory) => void;
  setStoppedEarly: (stopped: boolean) => void;
  setEndGameRequested: (requested: boolean) => void;
  setEndGameRequestReceived: (received: boolean) => void;
  updateTotalScores: (myScore: number, opponentScore: number) => void;
};

export const useGameStore = create<GameState>((set) => ({
  currentLetter: null,
  categories: [],
  answers: [],
  results: null,
  score: 0,
  isPlaying: false,
  timeRemaining: 120,
  
  // Multiplayer state
  isMultiplayer: false,
  isHost: false,
  opponentName: null,
  opponentResults: null,
  opponentScore: 0,

  // Round system state
  currentRound: 1,
  totalScore: 0,
  opponentTotalScore: 0,
  roundHistory: [],
  stoppedEarly: false,
  endGameRequested: false,
  endGameRequestReceived: false,

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

  startGame: (letter, categories) =>
    set({
      currentLetter: letter,
      categories,
      answers: [],
      results: null,
      score: 0,
      isPlaying: true,
      timeRemaining: 120,
      isMultiplayer: false,
      isHost: false,
      opponentName: null,
      opponentResults: null,
      opponentScore: 0,
      currentRound: 1,
      totalScore: 0,
      opponentTotalScore: 0,
      roundHistory: [],
      stoppedEarly: false,
      endGameRequested: false,
      endGameRequestReceived: false,
    }),

  startMultiplayerGame: (letter, categories, isHost, opponentName) =>
    set({
      currentLetter: letter,
      categories,
      answers: [],
      results: null,
      score: 0,
      isPlaying: true,
      timeRemaining: 120,
      isMultiplayer: true,
      isHost,
      opponentName,
      opponentResults: null,
      opponentScore: 0,
      currentRound: 1,
      totalScore: 0,
      opponentTotalScore: 0,
      roundHistory: [],
      stoppedEarly: false,
      endGameRequested: false,
      endGameRequestReceived: false,
    }),

  setMultiplayerResults: (myResults, myScore, stoppedEarly = false) =>
    set({
      results: myResults,
      score: myScore,
      stoppedEarly,
    }),

  setOpponentResults: (results, score) =>
    set({
      opponentResults: results,
      opponentScore: score,
    }),

  endGame: () => set({ isPlaying: false }),

  resetGame: () =>
    set({
      currentLetter: null,
      categories: [],
      answers: [],
      results: null,
      score: 0,
      isPlaying: false,
      timeRemaining: 120,
      isMultiplayer: false,
      isHost: false,
      opponentName: null,
      opponentResults: null,
      opponentScore: 0,
      currentRound: 1,
      totalScore: 0,
      opponentTotalScore: 0,
      roundHistory: [],
      stoppedEarly: false,
      endGameRequested: false,
      endGameRequestReceived: false,
    }),

  setTimeRemaining: (timeOrFn) => 
    set((state) => ({ 
      timeRemaining: typeof timeOrFn === 'function' ? timeOrFn(state.timeRemaining) : timeOrFn 
    })),

  // Round system actions
  startNewRound: (letter) =>
    set((state) => ({
      currentLetter: letter,
      currentRound: state.currentRound + 1,
      answers: [],
      results: null,
      score: 0,
      isPlaying: true,
      timeRemaining: 120,
      stoppedEarly: false,
      endGameRequested: false,
      endGameRequestReceived: false,
      opponentResults: null,
      opponentScore: 0,
    })),

  addRoundToHistory: (round) =>
    set((state) => ({
      roundHistory: [...state.roundHistory, round],
    })),

  setStoppedEarly: (stopped) => set({ stoppedEarly: stopped }),

  setEndGameRequested: (requested) => set({ endGameRequested: requested }),

  setEndGameRequestReceived: (received) => set({ endGameRequestReceived: received }),

  updateTotalScores: (myScore, opponentScore) =>
    set((state) => ({
      totalScore: state.totalScore + myScore,
      opponentTotalScore: state.opponentTotalScore + opponentScore,
    })),
}));