# Publicité AdMob — mise en production

L'app intègre `react-native-google-mobile-ads` :
- **Bannières** : accueil (`app/index.tsx`), résultats solo (`app/results.tsx`), écran final en ligne (`app/online-results.tsx`) — via `components/AdBanner.tsx`.
- **Interstitiel vidéo** : toutes les 2–3 parties terminées (`services/ads.ts`, compteur AsyncStorage). Jamais pendant une manche.
- **Consentement RGPD** : formulaire Google UMP affiché au premier lancement (`initAds()` dans `app/_layout.tsx`).

## État actuel : IDs DE TEST

`app.json` et `services/ads.ts` utilisent les **IDs de test Google**. Les pubs affichées sont des pubs de démonstration ; **aucun revenu**. En dev (`__DEV__`), les IDs de test sont toujours forcés (cliquer sur de vraies pubs en test = bannissement AdMob).

## Passer en production

1. Créer un compte sur https://admob.google.com et déclarer l'app Android (`com.tokami.boltexponativewind`).
2. Récupérer l'**App ID** (`ca-app-pub-XXXX~YYYY`) et le mettre dans `app.json` → plugin `react-native-google-mobile-ads` → `androidAppId` (remplace `ca-app-pub-3940256099942544~3347511713`).
3. Créer 2 blocs d'annonces : une **bannière adaptative** et un **interstitiel**.
4. Ajouter leurs IDs dans `eas.json` (profil `production`, section `env`) :
   ```json
   "EXPO_PUBLIC_ADMOB_BANNER_ID": "ca-app-pub-XXXX/BBBB",
   "EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID": "ca-app-pub-XXXX/IIII"
   ```
5. Dans AdMob → Confidentialité et messages, **publier un message de consentement RGPD** (sinon `loadAndShowConsentFormIfRequired()` ne montre rien et les pubs peuvent être limitées en Europe).
6. Rebuild natif obligatoire : `eas build --platform android --profile production`.

## Notes

- Le SDK n'existe pas dans Expo Go ni sur web : tout est no-op (l'app fonctionne normalement, sans pub).
- Nouveau compte AdMob : les annonces peuvent mettre quelques heures/jours à se remplir (fill rate faible au début, c'est normal).
