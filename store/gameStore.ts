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

  setLetter: (letter: string) => void;
  setCategories: (categories: Categorie[]) => void;
  setAnswer: (categorieId: number, word: string) => void;
  setResults: (results: GameResult[]) => void;
  setScore: (score: number) => void;
  startGame: (letter: string, categories: Categorie[]) => void;
  startMultiplayerGame: (letter: string, categories: Categorie[], isHost: boolean, opponentName: string) => void;
  setMultiplayerResults: (myResults: GameResult[], myScore: number) => void;
  setOpponentResults: (results: GameResult[], score: number) => void;
  endGame: () => void;
  resetGame: () => void;
  setTimeRemaining: (time: number) => void;
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
    }),

  setMultiplayerResults: (myResults, myScore) =>
    set({
      results: myResults,
      score: myScore,
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
    }),

  setTimeRemaining: (time) => set({ timeRemaining: time }),
}));