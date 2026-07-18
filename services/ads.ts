// services/ads.ts - Publicité AdMob (bannières + interstitiels vidéo)
// Politique "équilibrée" : bannières sur accueil/résultats, interstitiel
// toutes les 2-3 parties TERMINÉES, jamais pendant une manche chronométrée.
//
// Le module natif n'existe ni sur web ni dans Expo Go : tout passe par un
// require conditionnel (même pattern que services/bluetooth.ts) et chaque
// fonction est un no-op silencieux si le SDK est absent.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mobileAds: any = null;
let AdsConsent: any = null;
let InterstitialAd: any = null;
let AdEventType: any = null;
let TestIds: any = null;

if (Platform.OS !== 'web') {
  try {
    const ads = require('react-native-google-mobile-ads');
    mobileAds = ads.default;
    AdsConsent = ads.AdsConsent;
    InterstitialAd = ads.InterstitialAd;
    AdEventType = ads.AdEventType;
    TestIds = ads.TestIds;
  } catch (error) {
    console.warn('📢 SDK publicité non disponible (Expo Go ?)');
  }
}

// IDs des blocs d'annonces. En dev (__DEV__) on force les IDs de test Google ;
// en production ils viennent de l'env EAS (voir docs/ADMOB.md).
export function getBannerAdUnitId(): string | null {
  if (!TestIds) return null;
  if (__DEV__) return TestIds.ADAPTIVE_BANNER;
  return process.env.EXPO_PUBLIC_ADMOB_BANNER_ID || TestIds.ADAPTIVE_BANNER;
}

function getInterstitialAdUnitId(): string | null {
  if (!TestIds) return null;
  if (__DEV__) return TestIds.INTERSTITIAL;
  return process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID || TestIds.INTERSTITIAL;
}

export function adsAvailable(): boolean {
  return mobileAds !== null;
}

let initialized = false;
let interstitial: any = null;
let interstitialLoaded = false;

const GAME_COUNT_KEY = 'adsGameCount';
// Seuil courant : 2 ou 3 parties entre deux interstitiels ("équilibré")
let currentThreshold = 2 + Math.floor(Math.random() * 2);

/**
 * Consentement RGPD (Google UMP) puis initialisation du SDK.
 * À appeler une fois au démarrage (app/_layout.tsx). Ne bloque jamais l'app :
 * en cas d'échec (hors ligne, formulaire indisponible), on continue sans pub.
 */
export async function initAds(): Promise<void> {
  if (!mobileAds || initialized) return;

  try {
    await AdsConsent.requestInfoUpdate();
    await AdsConsent.loadAndShowConsentFormIfRequired();
  } catch (error) {
    console.warn('📢 Consentement pub indisponible:', error);
  }

  try {
    await mobileAds().initialize();
    initialized = true;
    preloadInterstitial();
  } catch (error) {
    console.warn('📢 Init pub échouée:', error);
  }
}

function preloadInterstitial(): void {
  const adUnitId = getInterstitialAdUnitId();
  if (!InterstitialAd || !adUnitId) return;

  interstitialLoaded = false;
  interstitial = InterstitialAd.createForAdRequest(adUnitId, {
    requestNonPersonalizedAdsOnly: false,
  });

  interstitial.addAdEventListener(AdEventType.LOADED, () => {
    interstitialLoaded = true;
  });
  interstitial.addAdEventListener(AdEventType.CLOSED, () => {
    // Précharger la suivante dès la fermeture
    preloadInterstitial();
  });
  interstitial.addAdEventListener(AdEventType.ERROR, (e: unknown) => {
    console.warn('📢 Interstitiel non chargé:', e);
  });

  interstitial.load();
}

/**
 * À appeler quand une partie est TERMINÉE (écran de résultats final).
 * Affiche un interstitiel toutes les 2-3 parties, si une pub est prête.
 * Jamais bloquant : sans pub chargée, le compteur est simplement conservé.
 */
export async function maybeShowInterstitial(): Promise<void> {
  if (!initialized) return;

  let count = 0;
  try {
    count = parseInt((await AsyncStorage.getItem(GAME_COUNT_KEY)) || '0', 10) + 1;
    await AsyncStorage.setItem(GAME_COUNT_KEY, String(count));
  } catch {
    return;
  }

  if (count < currentThreshold || !interstitialLoaded || !interstitial) return;

  try {
    await interstitial.show();
    await AsyncStorage.setItem(GAME_COUNT_KEY, '0');
    currentThreshold = 2 + Math.floor(Math.random() * 2);
  } catch (error) {
    console.warn('📢 Affichage interstitiel échoué:', error);
  }
}
