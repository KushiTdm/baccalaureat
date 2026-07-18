// app/index.tsx
import { View, Text, StyleSheet, Alert, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  BounceIn,
} from 'react-native-reanimated';
import { Wifi, WifiOff, Globe, Bluetooth, Zap, Sparkles, RefreshCw, AlertCircle, Settings, Trophy } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, fonts, radius, spacing, shadow } from '../constants/theme';

// Services et stores
import { getCategories, downloadDictionary, isOnline } from '../services/api';
import { isDictionaryDownloaded } from '../utils/storage';
import { initOfflineDatabase, loadOfflineDictionary } from '../services/offline';
import { useGameStore } from '../store/gameStore';
import { useUserStore } from '../store/userStore';
import { pickRandomLetter } from '../utils/letters';
import { useSettingsStore, filterEnabledCategories } from '../store/settingsStore';

// Composants
import AdBanner from '../components/AdBanner';

export default function HomeScreen() {
  const router = useRouter();
  const { startGame } = useGameStore();
  const { user, isLoading: authLoading, login, loginOffline, needsUsername } = useUserStore();

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [hasOfflineDict, setHasOfflineDict] = useState(false);
  const [online, setOnline] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    initializeApp();
  }, []);

  // Rediriger vers l'écran de choix du pseudo si nécessaire
  useEffect(() => {
    if (!authLoading && user && needsUsername) {
      router.replace('/username-setup');
    }
  }, [authLoading, user, needsUsername]);

  async function initializeApp() {
    try {
      setConnectionError(null);
      // 1. Connexion automatique
      await login();

      // 2. Vérifier le statut
      await checkStatus();
    } catch (error: any) {
      console.error('Erreur initialisation:', error);
      const errorMessage = error?.message || 'Erreur inconnue';
      setConnectionError(errorMessage);
    } finally {
      setInitializing(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    setInitializing(true);
    try {
      await initializeApp();
    } finally {
      setRetrying(false);
    }
  }

  async function handleContinueOffline() {
    try {
      setConnectionError(null);
      // Utilisateur local persisté (fallback hors ligne, sans Supabase)
      await loginOffline();
      await checkStatus();
    } catch (error: any) {
      console.error('Erreur mode hors ligne:', error);
      setConnectionError(error?.message || 'Impossible de démarrer en mode hors ligne');
    } finally {
      setInitializing(false);
    }
  }

  async function checkStatus() {
    const downloaded = await isDictionaryDownloaded();
    setHasOfflineDict(downloaded);

    const networkStatus = await isOnline();
    setOnline(networkStatus);

    if (downloaded) {
      await initOfflineDatabase();
      await loadOfflineDictionary();
    }
  }

  async function handleStartGame() {
    if (!user) {
      Alert.alert('Erreur', 'Veuillez vous connecter');
      return;
    }

    setLoading(true);
    try {
      const categories = filterEnabledCategories(await getCategories());
      if (categories.length === 0) {
        Alert.alert('Erreur', 'Aucune catégorie disponible');
        return;
      }

      const randomLetter = pickRandomLetter();
      startGame(randomLetter, categories, useSettingsStore.getState().roundDurationSec);
      router.push('/game');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de charger les catégories');
    } finally {
      setLoading(false);
    }
  }

  async function handleStartMultiplayer() {
    if (!user) {
      Alert.alert('Erreur', 'Veuillez vous connecter');
      return;
    }
    router.push('/multiplayer-setup');
  }

  async function handleStartOnline() {
    if (!user) {
      Alert.alert('Erreur', 'Veuillez vous connecter');
      return;
    }

    if (!online) {
      Alert.alert('Hors ligne', 'Vous devez être connecté pour jouer en ligne');
      return;
    }
    router.push('/online-setup');
  }

  async function handleDownloadDictionary() {
    if (!online) {
      Alert.alert('Hors ligne', 'Vous devez être connecté pour télécharger le dictionnaire');
      return;
    }

    setDownloading(true);
    try {
      await downloadDictionary();
      await initOfflineDatabase();
      await loadOfflineDictionary();
      setHasOfflineDict(true);
      Alert.alert('Succès', 'Le dictionnaire a été téléchargé avec succès');
    } catch (error: any) {
      console.error('Download error:', error);
      Alert.alert(
        'Erreur',
        error.message || 'Impossible de télécharger le dictionnaire'
      );
    } finally {
      setDownloading(false);
    }
  }

  function handleProfile() {
    router.push('/profile');
  }

  // Écran de chargement initial
  if (initializing || authLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Animated.View entering={BounceIn.duration(800)}>
          <Sparkles size={64} color={colors.primary} />
        </Animated.View>
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 20 }} />
        <Text style={styles.loadingText}>
          {retrying ? 'Nouvelle tentative...' : 'Chargement...'}
        </Text>
      </View>
    );
  }

  // Écran d'erreur de connexion
  if (connectionError && !user) {
    return (
      <View style={styles.errorContainer}>
        <Animated.View entering={BounceIn.duration(800)}>
          <AlertCircle size={80} color={colors.danger} />
        </Animated.View>
        <Text style={styles.errorTitle}>Erreur de connexion</Text>
        <Text style={styles.errorMessage}>
          Impossible de se connecter au serveur.
        </Text>
        <View style={styles.errorDetailsCard}>
          <Text style={styles.errorDetailsLabel}>Détails :</Text>
          <Text style={styles.errorDetailsText}>{connectionError}</Text>
        </View>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={handleRetry}
          disabled={retrying}
        >
          <RefreshCw
            size={20}
            color={colors.onPrimary}
            style={retrying ? styles.spinningIcon : undefined}
          />
          <Text style={styles.retryButtonText}>
            {retrying ? 'Connexion...' : 'Réessayer'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.offlineButton}
          onPress={handleContinueOffline}
          disabled={retrying}
        >
          <WifiOff size={20} color={colors.primary} />
          <Text style={[styles.retryButtonText, styles.offlineButtonText]}>Continuer hors ligne</Text>
        </TouchableOpacity>
        <Text style={styles.errorHelp}>
          Vérifiez votre connexion internet et réessayez, ou continuez hors ligne avec un profil local.
        </Text>
      </View>
    );
  }

  const initial = (user?.username || 'J').trim().charAt(0).toUpperCase();

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* En-tête : salutation + accès rapides */}
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.greetingRow}>
          <View>
            <Text style={styles.greetingHello}>Bonjour 👋</Text>
            <Text style={styles.greetingName}>{user?.username || 'Joueur'}</Text>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/leaderboard')}>
              <Trophy size={19} color={colors.gold} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/settings')}>
              <Settings size={19} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleProfile}>
              <LinearGradient
                colors={gradients.sunset}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatar}
              >
                <Text style={styles.avatarInitial}>{initial}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Carte héros : lancer une nouvelle partie */}
        <Animated.View entering={FadeInUp.delay(200).springify()} style={styles.heroWrapper}>
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={styles.heroCard}
          >
            <Text style={styles.heroWatermark}>B</Text>
            <View style={styles.heroBadge}>
              <Sparkles size={16} color={colors.onPrimary} />
            </View>
            <Text style={styles.heroTitle}>Nouvelle partie</Text>
            <Text style={styles.heroSubtitle}>
              Une lettre, plusieurs catégories, un chrono lancé.{'\n'}Trouvez vos mots avant la fin du temps !
            </Text>
            <TouchableOpacity
              style={styles.heroButton}
              onPress={handleStartGame}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <Zap size={18} color={colors.primary} />
                  <Text style={styles.heroButtonText}>Créer une partie</Text>
                </>
              )}
            </TouchableOpacity>
          </LinearGradient>
        </Animated.View>

        {/* Actions rapides : multijoueur */}
        <Animated.View entering={FadeInUp.delay(300).springify()} style={styles.quickRow}>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={handleStartOnline}
            disabled={!online}
            activeOpacity={0.8}
          >
            <View style={[styles.quickIconWrap, { backgroundColor: colors.primarySoft }]}>
              <Globe size={22} color={colors.primary} />
            </View>
            <Text style={styles.quickTitle}>Jeu en ligne</Text>
            <Text style={styles.quickSubtitle}>
              {online ? 'Défiez un joueur' : 'Connexion requise'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickCard}
            onPress={handleStartMultiplayer}
            activeOpacity={0.8}
          >
            <View style={[styles.quickIconWrap, { backgroundColor: colors.pinkSoft }]}>
              <Bluetooth size={22} color={colors.pink} />
            </View>
            <Text style={styles.quickTitle}>Bluetooth</Text>
            <Text style={styles.quickSubtitle}>Face à face, sans internet</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Statut connexion + dictionnaire hors ligne */}
        <Animated.View entering={FadeInUp.delay(400).springify()} style={styles.statusCard}>
          <View style={styles.statusRow}>
            {online ? (
              <Wifi size={18} color={colors.success} />
            ) : (
              <WifiOff size={18} color={colors.danger} />
            )}
            <Text style={styles.statusText}>{online ? 'En ligne' : 'Hors ligne'}</Text>
            {hasOfflineDict && (
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>Dico prêt</Text>
              </View>
            )}
          </View>

          <TouchableOpacity onPress={handleDownloadDictionary} disabled={!online || downloading}>
            {downloading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.statusAction, !online && styles.statusActionDisabled]}>
                {hasOfflineDict ? 'Mettre à jour' : 'Télécharger'}
              </Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        {!online && (
          <Animated.View entering={FadeIn.delay(500)} style={styles.warningCard}>
            <Text style={styles.warningText}>
              📡 Connexion requise pour le mode en ligne
            </Text>
          </Animated.View>
        )}
      </ScrollView>

      {/* Bannière pub ancrée en bas (app gratuite) */}
      <AdBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 18,
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.xl,
    paddingTop: 60,
    paddingBottom: 40,
    gap: spacing.lg,
  },
  // En-tête : salutation + avatar
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  greetingHello: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  greetingName: {
    fontSize: 24,
    fontFamily: fonts.displayBold,
    color: colors.text,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow.card,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow.card,
  },
  avatarInitial: {
    fontSize: 18,
    fontFamily: fonts.displayBold,
    color: colors.onPrimary,
  },
  // Carte héros indigo (dégradé + lettre en filigrane, du design)
  heroWrapper: {
    borderRadius: radius.xl,
    ...shadow.glow(colors.primary),
  },
  heroCard: {
    borderRadius: radius.xl,
    padding: 24,
    overflow: 'hidden',
  },
  heroWatermark: {
    position: 'absolute',
    right: -10,
    top: -22,
    fontSize: 130,
    lineHeight: 130,
    fontFamily: fonts.displayBold,
    color: colors.onPrimarySurface,
  },
  heroBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.onPrimarySurface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 24,
    fontFamily: fonts.display,
    color: colors.onPrimary,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    color: colors.onPrimarySecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  heroButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: colors.onPrimary,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: radius.full,
    minWidth: 170,
  },
  heroButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  // Actions rapides
  quickRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  quickCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  quickIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  quickTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  quickSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  // Statut connexion / dictionnaire
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  statusBadge: {
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    marginLeft: spacing.xs,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.success,
  },
  statusAction: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  statusActionDisabled: {
    color: colors.textMuted,
  },
  warningCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  warningText: {
    textAlign: 'center',
    fontSize: 14,
    color: colors.goldDeep,
    fontWeight: '600',
    lineHeight: 20,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorTitle: {
    fontSize: 28,
    fontFamily: fonts.display,
    color: colors.text,
    marginTop: 24,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 24,
  },
  errorDetailsCard: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: 16,
    marginTop: 20,
    width: '100%',
    maxWidth: 350,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorDetailsLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
    fontWeight: '600',
  },
  errorDetailsText: {
    fontSize: 14,
    color: colors.danger,
    lineHeight: 20,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: radius.lg,
    marginTop: 24,
    gap: 8,
    ...shadow.glow(colors.primary),
  },
  retryButtonText: {
    fontSize: 16,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  offlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: radius.lg,
    marginTop: 12,
    gap: 8,
    ...shadow.card,
  },
  offlineButtonText: {
    color: colors.primary,
  },
  spinningIcon: {
    transform: [{ rotate: '360deg' }],
  },
  errorHelp: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 16,
    textAlign: 'center',
  },
});
