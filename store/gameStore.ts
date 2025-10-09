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

  setLetter: (letter: string) => void;
  setCategories: (categories: Categorie[]) => void;
  setAnswer: (categorieId: number, word: string) => void;
  setResults: (results: GameResult[]) => void;
  setScore: (score: number) => void;
  startGame: (letter: string, categories: Categorie[]) => void;
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
    }),

  setTimeRemaining: (time) => set({ timeRemaining: time }),
}));
