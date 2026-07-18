// store/settingsStore.ts - Réglages de partie persistés (AsyncStorage)
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'gameSettings';

export const ROUND_DURATIONS = [60, 120, 180] as const;

type SettingsState = {
  roundDurationSec: number;
  disabledCategoryIds: number[];
  soundsEnabled: boolean;
  hapticsEnabled: boolean;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  setRoundDuration: (sec: number) => void;
  toggleCategory: (categoryId: number) => void;
  setSoundsEnabled: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
};

async function persist(state: SettingsState) {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        roundDurationSec: state.roundDurationSec,
        disabledCategoryIds: state.disabledCategoryIds,
        soundsEnabled: state.soundsEnabled,
        hapticsEnabled: state.hapticsEnabled,
      })
    );
  } catch {
    // best-effort
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  roundDurationSec: 120,
  disabledCategoryIds: [],
  soundsEnabled: true,
  hapticsEnabled: true,
  loaded: false,

  loadSettings: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        set({
          roundDurationSec: saved.roundDurationSec ?? 120,
          disabledCategoryIds: saved.disabledCategoryIds ?? [],
          soundsEnabled: saved.soundsEnabled ?? true,
          hapticsEnabled: saved.hapticsEnabled ?? true,
        });
      }
    } catch {
      // valeurs par défaut
    } finally {
      set({ loaded: true });
    }
  },

  setRoundDuration: (sec) => {
    set({ roundDurationSec: sec });
    persist(get());
  },

  toggleCategory: (categoryId) => {
    set((state) => ({
      disabledCategoryIds: state.disabledCategoryIds.includes(categoryId)
        ? state.disabledCategoryIds.filter((id) => id !== categoryId)
        : [...state.disabledCategoryIds, categoryId],
    }));
    persist(get());
  },

  setSoundsEnabled: (enabled) => {
    set({ soundsEnabled: enabled });
    persist(get());
  },

  setHapticsEnabled: (enabled) => {
    set({ hapticsEnabled: enabled });
    persist(get());
  },
}));

/**
 * Filtre les catégories selon les réglages. Garde-fou : si l'utilisateur a
 * tout désactivé, on rend la liste complète (une partie sans catégorie n'a
 * pas de sens).
 */
export function filterEnabledCategories<T extends { id: number }>(categories: T[]): T[] {
  const disabled = useSettingsStore.getState().disabledCategoryIds;
  const filtered = categories.filter((c) => !disabled.includes(c.id));
  return filtered.length > 0 ? filtered : categories;
}
