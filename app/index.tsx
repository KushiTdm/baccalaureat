// app/index.tsx
import { View, Text, StyleSheet, Alert, ScrollView, Dimensions, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  SlideInRight,
  SlideInLeft,
  BounceIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { Download, Wifi, WifiOff, Globe, Bluetooth, Zap, Sparkles } from 'lucide-react-native';

// Services et stores
import { getCategories, downloadDictionary, isOnline } from '../services/api';
import { isDictionaryDownloaded } from '../utils/storage';
import { initOfflineDatabase, loadOfflineDictionary } from '../services/offline';
import { useGameStore } from '../store/gameStore';
import { useUserStore } from '../store/userStore';

// Composants
import Button from '../components/Button';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Particules flottantes en arrière-plan
const FloatingParticle = ({ delay, duration, startX, startY }: any) => {
  const translateY = useSharedValue(startY);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withRepeat(
      withSequence(
        withTiming(startY - 100, { duration }),
        withTiming(startY, { duration })
      ),
      -1,
      true
    );

    opacity.value = withRepeat(
      withSequence(
        withTiming(0.6, { duration: duration / 2 }),
        withTiming(0.2, { duration: duration / 2 })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: startX,
          top: startY,
        },
        animatedStyle,
      ]}
    />
  );
};

export default function HomeScreen() {
  const router = useRouter();
  const { startGame } = useGameStore();
  const { user, isLoading: authLoading, login, needsUsername } = useUserStore();

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [hasOfflineDict, setHasOfflineDict] = useState(false);
  const [online, setOnline] = useState(true);
  const [initializing, setInitializing] = useState(true);

  // Animations
  const titleScale = useSharedValue(1);
  const titleRotate = useSharedValue(0);
  const glowPulse = useSharedValue(1);

  useEffect(() => {
    initializeApp();
  }, []);

  // Rediriger vers l'écran de choix du pseudo si nécessaire
  useEffect(() => {
    if (!authLoading && user && needsUsername) {
      router.replace('/username-setup');
    }
  }, [authLoading, user, needsUsername]);

  // Animations du titre
  useEffect(() => {
    titleScale.value = withRepeat(
      withSequence(
        withSpring(1.05, { damping: 2 }),
        withSpring(1, { damping: 2 })
      ),
      -1,
      true
    );

    titleRotate.value = withRepeat(
      withSequence(
        withTiming(2, { duration: 2000 }),
        withTiming(-2, { duration: 2000 })
      ),
      -1,
      true
    );

    glowPulse.value = withRepeat(
      withSequence(
        withTiming(1.3, { duration: 1500 }),
        withTiming(1, { duration: 1500 })
      ),
      -1,
      true
    );
  }, []);

  const titleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: titleScale.value },
      { rotate: `${titleRotate.value}deg` }
    ],
  }));

  const glowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowPulse.value }],
    opacity: interpolate(glowPulse.value, [1, 1.3], [0.3, 0.6]),
  }));

  async function initializeApp() {
    try {
      // 1. Connexion automatique
      await login();

      // 2. Vérifier le statut
      await checkStatus();
    } catch (error: any) {
      console.error('Erreur initialisation:', error);
      const errorMessage = error?.message || 'Erreur inconnue';
      Alert.alert(
        'Erreur de connexion', 
        `Impossible de se connecter au serveur.\n\nDétails: ${errorMessage}\n\nVérifiez votre connexion internet.`
      );
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
      const categories = await getCategories();
      if (categories.length === 0) {
        Alert.alert('Erreur', 'Aucune catégorie disponible');
        return;
      }

      const randomLetter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      startGame(randomLetter, categories);
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
          <Sparkles size={64} color="#007AFF" />
        </Animated.View>
        <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Gradient de fond animé */}
      <Animated.View
        entering={FadeIn.duration(1000)}
        style={styles.backgroundGradient}
      />

      {/* Particules flottantes */}
      <FloatingParticle delay={0} duration={4000} startX={50} startY={100} />
      <FloatingParticle delay={500} duration={5000} startX={300} startY={200} />
      <FloatingParticle delay={1000} duration={4500} startX={150} startY={400} />
      <FloatingParticle delay={1500} duration={5500} startX={280} startY={500} />
      <FloatingParticle delay={2000} duration={4200} startX={100} startY={300} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        {/* En-tête avec animations */}
        <Animated.View
          entering={FadeInDown.delay(200).springify()}
          style={styles.header}
        >
          {/* Glow effect derrière le titre */}
          <Animated.View style={[styles.titleGlow, glowAnimatedStyle]} />

          <Animated.View style={titleAnimatedStyle}>
            <Text style={styles.title}>Petit Bac</Text>
          </Animated.View>

          <Animated.View entering={FadeIn.delay(400)}>
            <Text style={styles.subtitle}>Jeu de Baccalauréat</Text>
          </Animated.View>

          {/* Décoration */}
          <Animated.View
            entering={BounceIn.delay(600)}
            style={styles.decorativeCircle}
          >
            <Sparkles size={32} color="#FFD700" />
          </Animated.View>
        </Animated.View>

        {/* Carte de statut avec animation */}
        <Animated.View
          entering={SlideInLeft.delay(300).springify()}
          style={styles.statusCard}
        >
          <View style={styles.statusRow}>
            {online ? (
              <Wifi size={24} color="#4caf50" />
            ) : (
              <WifiOff size={24} color="#f44336" />
            )}
            <Text style={styles.statusText}>
              {online ? 'En ligne' : 'Hors ligne'}
            </Text>
            <View style={[styles.statusDot, online && styles.statusDotOnline]} />
          </View>

          {hasOfflineDict && (
            <Animated.View
              entering={FadeInUp.delay(400)}
              style={[styles.statusRow, { marginTop: 12 }]}
            >
              <Download size={24} color="#2196f3" />
              <Text style={styles.statusText}>Dictionnaire prêt</Text>
              <View style={styles.checkmark}>
                <Text style={styles.checkmarkText}>✓</Text>
              </View>
            </Animated.View>
          )}
        </Animated.View>

        {/* Carte d'information avec effet glassmorphism */}
        <Animated.View
          entering={SlideInRight.delay(400).springify()}
          style={styles.infoCard}
        >
          <View style={styles.infoHeader}>
            <Zap size={24} color="#007AFF" />
            <Text style={styles.infoTitle}>Comment jouer ?</Text>
          </View>

          <View style={styles.infoContent}>
            {[
              'Une lettre aléatoire sera choisie',
              'Trouvez un mot pour chaque catégorie',
              'Vous avez 2 minutes pour tout remplir',
              'Chaque mot valide = 10 points'
            ].map((text, index) => (
              <Animated.View
                key={index}
                entering={FadeInUp.delay(500 + index * 100)}
                style={styles.infoItem}
              >
                <View style={styles.infoBullet} />
                <Text style={styles.infoText}>{text}</Text>
              </Animated.View>
            ))}
          </View>
        </Animated.View>

        {/* Boutons avec animations */}
        <Animated.View
          entering={FadeInUp.delay(600)}
          style={styles.buttonContainer}
        >
          <Button
            title="🎮 Jouer solo"
            onPress={handleStartGame}
            loading={loading}
          />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>Modes multijoueur</Text>
            <View style={styles.dividerLine} />
          </View>

          <Button
            title="🌐 Jeu en ligne"
            onPress={handleStartOnline}
            variant="secondary"
            icon={<Globe size={20} color="#007AFF" />}
            disabled={!online}
          />

          <Button
            title="📱 Bluetooth (local)"
            onPress={handleStartMultiplayer}
            variant="secondary"
            icon={<Bluetooth size={20} color="#007AFF" />}
          />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
          </View>

          <Button
            title={hasOfflineDict ? '🔄 Mettre à jour' : '⬇️ Télécharger dictionnaire'}
            onPress={handleDownloadDictionary}
            variant="secondary"
            loading={downloading}
            disabled={!online}
          />
        </Animated.View>

        {/* Messages d'avertissement */}
        {!hasOfflineDict && (
          <Animated.View
            entering={FadeIn.delay(800)}
            style={styles.warningCard}
          >
            <Text style={styles.warningText}>
              💡 Téléchargez le dictionnaire pour jouer hors ligne
            </Text>
          </Animated.View>
        )}

        {!online && (
          <Animated.View
            entering={FadeIn.delay(900)}
            style={styles.warningCard}
          >
            <Text style={styles.warningText}>
              📡 Connexion requise pour le mode en ligne
            </Text>
          </Animated.View>
        )}

        {/* Footer décoratif */}
        <Animated.View
          entering={FadeIn.delay(1000)}
          style={styles.footer}
        >
          <Text style={styles.footerText}>Prêt à jouer ? 🎯</Text>
          {user && (
            <Text style={styles.footerSubtext}>
              Connecté en tant que {user.username || 'Joueur'}
            </Text>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050816',
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#050816',
  },
  particle: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(0, 122, 255, 0.4)',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0a0e27',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
    marginTop: 8,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    position: 'relative',
  },
  titleGlow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#007AFF',
    opacity: 0.3,
  },
  title: {
    fontSize: 56,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 8,
    textShadowColor: 'rgba(59, 130, 246, 0.5)',
    textShadowOffset: { width: 0, height: 8 },
    textShadowRadius: 30,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
    letterSpacing: 1,
  },
  decorativeCircle: {
    marginTop: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 215, 0, 0.3)',
  },
  statusCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#f44336',
  },
  statusDotOnline: {
    backgroundColor: '#4caf50',
    shadowColor: '#4caf50',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    fontSize: 16,
    color: '#4caf50',
    fontWeight: 'bold',
  },
  infoCard: {
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
    borderRadius: 24,
    padding: 24,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.2)',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },
  infoContent: {
    gap: 14,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#007AFF',
    marginTop: 6,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  infoText: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 22,
    flex: 1,
  },
  buttonContainer: {
    gap: 14,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  dividerText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  warningCard: {
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 152, 0, 0.3)',
  },
  warningText: {
    textAlign: 'center',
    fontSize: 14,
    color: '#ff9800',
    fontWeight: '600',
    lineHeight: 20,
  },
  footer: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 20,
    gap: 8,
  },
  footerText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
  },
  footerSubtext: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.4)',
    fontWeight: '500',
  },
});