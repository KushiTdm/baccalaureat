// components/AdBanner.tsx - Bannière AdMob adaptative
// Rend null si le SDK est absent (web/Expo Go) ou si la pub ne charge pas :
// jamais de trou visuel dans la mise en page.
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { adsAvailable, getBannerAdUnitId } from '../services/ads';
import { colors, spacing } from '../constants/theme';

let BannerAd: any = null;
let BannerAdSize: any = null;

if (Platform.OS !== 'web') {
  try {
    const ads = require('react-native-google-mobile-ads');
    BannerAd = ads.BannerAd;
    BannerAdSize = ads.BannerAdSize;
  } catch {
    // SDK absent : le composant rendra null
  }
}

export default function AdBanner() {
  const [failed, setFailed] = useState(false);
  const adUnitId = getBannerAdUnitId();

  if (!adsAvailable() || !BannerAd || !adUnitId || failed) {
    return null;
  }

  return (
    <View style={styles.container}>
      <BannerAd
        unitId={adUnitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    paddingTop: spacing.sm,
  },
});
