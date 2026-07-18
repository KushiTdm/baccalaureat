//app/_layout.tsx
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import {
  useFonts,
  Fredoka_500Medium,
  Fredoka_600SemiBold,
  Fredoka_700Bold,
} from '@expo-google-fonts/fredoka';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { colors } from '@/constants/theme';
import { initAds } from '@/services/ads';
import { useSettingsStore } from '@/store/settingsStore';
import 'react-native-url-polyfill/auto';

export default function RootLayout() {
  useFrameworkReady();

  // Police display du design (titres, lettres, chiffres)
  const [fontsLoaded] = useFonts({
    Fredoka_500Medium,
    Fredoka_600SemiBold,
    Fredoka_700Bold,
  });

  // Consentement RGPD + init du SDK pub (no-op sur web / Expo Go)
  // + chargement des réglages persistés
  useEffect(() => {
    initAds();
    useSettingsStore.getState().loadSettings();
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          // Fond du thème pendant les transitions (évite les flashs)
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="game" />
        <Stack.Screen name="results" />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="dark" />
    </>
  );
}
