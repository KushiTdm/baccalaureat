// services/feedback.ts - Sons + vibrations centralisés
// API : feedback.tick() / stop() / victory() / defeat() / success() / error()
// Chaque appel respecte les réglages (soundsEnabled / hapticsEnabled) et n'est
// JAMAIS bloquant : require conditionnel + try/catch no-op sur web, même
// pattern que services/ads.ts. Les 4 players audio sont préchargés une fois.
import { Platform } from 'react-native';
import { useSettingsStore } from '../store/settingsStore';

let Haptics: any = null;
let createAudioPlayer: any = null;
let setAudioModeAsync: any = null;

if (Platform.OS !== 'web') {
  try {
    Haptics = require('expo-haptics');
  } catch {
    console.warn('🔊 expo-haptics non disponible');
  }
  try {
    const audio = require('expo-audio');
    createAudioPlayer = audio.createAudioPlayer;
    setAudioModeAsync = audio.setAudioModeAsync;
  } catch {
    console.warn('🔊 expo-audio non disponible');
  }
}

type SoundName = 'tick' | 'stop' | 'victory' | 'defeat';

// Players préchargés au premier import (sons courts générés dans assets/sounds)
const players: Partial<Record<SoundName, any>> = {};

if (createAudioPlayer) {
  try {
    // iOS : jouer même en mode silencieux (sons de jeu courts)
    if (setAudioModeAsync) {
      setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    }
    players.tick = createAudioPlayer(require('../assets/sounds/tick.wav'));
    players.stop = createAudioPlayer(require('../assets/sounds/stop.wav'));
    players.victory = createAudioPlayer(require('../assets/sounds/victory.wav'));
    players.defeat = createAudioPlayer(require('../assets/sounds/defeat.wav'));
  } catch (error) {
    console.warn('🔊 Préchargement des sons échoué:', error);
  }
}

function playSound(name: SoundName): void {
  if (!useSettingsStore.getState().soundsEnabled) return;
  const player = players[name];
  if (!player) return;
  try {
    // Un player déjà joué reste à la fin du son : on rembobine avant de rejouer
    const seek = player.seekTo(0);
    if (seek && typeof seek.catch === 'function') seek.catch(() => {});
    player.play();
  } catch {
    // no-op : le feedback ne doit jamais casser le jeu
  }
}

function haptic(run: (h: any) => Promise<void>): void {
  if (!Haptics) return;
  if (!useSettingsStore.getState().hapticsEnabled) return;
  try {
    run(Haptics).catch(() => {});
  } catch {
    // no-op
  }
}

export const feedback = {
  /** Décompte des 10 dernières secondes (léger, appelé chaque seconde) */
  tick(): void {
    playSound('tick');
    haptic((h) => h.impactAsync(h.ImpactFeedbackStyle.Light));
  },

  /** STOP! reçu (fin de manche simultanée) */
  stop(): void {
    playSound('stop');
    haptic((h) => h.notificationAsync(h.NotificationFeedbackType.Warning));
  },

  /** Victoire (fin de partie) */
  victory(): void {
    playSound('victory');
    haptic((h) => h.notificationAsync(h.NotificationFeedbackType.Success));
  },

  /** Défaite (fin de partie) */
  defeat(): void {
    playSound('defeat');
    haptic((h) => h.notificationAsync(h.NotificationFeedbackType.Error));
  },

  /** Confirmation générique (haptique seule) */
  success(): void {
    haptic((h) => h.notificationAsync(h.NotificationFeedbackType.Success));
  },

  /** Erreur générique (haptique seule) */
  error(): void {
    haptic((h) => h.notificationAsync(h.NotificationFeedbackType.Error));
  },
};
