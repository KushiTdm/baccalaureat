import { View, Text, StyleSheet, Alert, ScrollView, Dimensions } from 'react-native';
import { useState, useEffect } from 'react';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  SlideInRight,
  SlideInLeft,
  BounceIn,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SAFE_BOTTOM_HEIGHT = SCREEN_HEIGHT * 0.12;

// Composant Button simulé
const Button = ({ title, onPress, loading, disabled, variant, icon }) => (
  <Animated.View 
    entering={FadeInUp.delay(400).springify()}
    style={[
      styles.button,
      variant === 'secondary' && styles.buttonSecondary,
      disabled && styles.buttonDisabled
    ]}
  >
    <Text 
      onPress={!loading && !disabled ? onPress : undefined}
      style={[
        styles.buttonText,
        variant === 'secondary' && styles.buttonTextSecondary
      ]}
    >
      {icon && <View style={styles.buttonIcon}>{icon}</View>}
      {loading ? 'Chargement...' : title}
    </Text>
  </Animated.View>
);

// Icônes simulées
const Wifi = ({ size, color }) => <View style={[styles.icon, { width: size, height: size, backgroundColor: color }]} />;
const WifiOff = ({ size, color }) => <View style={[styles.icon, { width: size, height: size, backgroundColor: color }]} />;
const Download = ({ size, color }) => <View style={[styles.icon, { width: size, height: size, backgroundColor: color }]} />;
const Globe = ({ size, color }) => <View style={[styles.icon, { width: size, height: size, backgroundColor: color, borderRadius: size/2 }]} />;
const Bluetooth = ({ size, color }) => <View style={[styles.icon, { width: size, height: size, backgroundColor: color }]} />;
const Zap = ({ size, color }) => <View style={[styles.icon, { width: size, height: size, backgroundColor: color }]} />;
const Sparkles = ({ size, color }) => <View style={[styles.icon, { width: size, height: size, backgroundColor: color }]} />;

// Particules flottantes en arrière-plan
const FloatingParticle = ({ delay, duration, startX, startY }) => {
  const translateY = useSharedValue(startY);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withRepeat(
      withSequence(
        withTiming(startY - 100, { duration: duration }),
        withTiming(startY, { duration: duration })
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
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [hasOfflineDict, setHasOfflineDict] = useState(false);
  const [online, setOnline] = useState(true);

  // Animations
  const titleScale = useSharedValue(1);
  const titleRotate = useSharedValue(0);
  const glowPulse = useSharedValue(1);
  const scrollY = useSharedValue(0);

  useEffect(() => {
    // Animation du titre
    titleScale.value = withRepeat(
      withSequence(
        withSpring(1.05, { damping: 2 }),
        withSpring(1, { damping: 2 })
      ),
      -1,
      true
    );

    // Animation de rotation subtile
    titleRotate.value = withRepeat(
      withSequence(
        withTiming(2, { duration: 2000 }),
        withTiming(-2, { duration: 2000 })
      ),
      -1,
      true
    );

    // Animation de glow pulsant
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

  const handleStartGame = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      Alert.alert('Succès', 'Lancement du jeu...');
    }, 1000);
  };

  const handleStartMultiplayer = () => {
    Alert.alert('Multiplayer', 'Mode Bluetooth');
  };

  const handleStartOnline = () => {
    if (!online) {
      Alert.alert('Hors ligne', 'Connexion requise');
      return;
    }
    Alert.alert('Online', 'Mode en ligne');
  };

  const handleDownloadDictionary = () => {
    if (!online) {
      Alert.alert('Hors ligne', 'Connexion requise');
      return;
    }
    setDownloading(true);
    setTimeout(() => {
      setDownloading(false);
      setHasOfflineDict(true);
      Alert.alert('Succès', 'Dictionnaire téléchargé');
    }, 2000);
  };

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
              <View style={styles.checkmark}>✓</View>
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
              'Chaque mot valide = 2 points'
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
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e27',
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'linear-gradient(135deg, #0a0e27 0%, #1a1f3a 50%, #0f1428 100%)',
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
    filter: 'blur(80px)',
    opacity: 0.3,
  },
  title: {
    fontSize: 52,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 122, 255, 0.8)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 20,
    letterSpacing: 2,
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
    backdropFilter: 'blur(20px)',
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
    fontSize: 16,
    color: '#4caf50',
    fontWeight: 'bold',
  },
  infoCard: {
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
    backdropFilter: 'blur(20px)',
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
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  buttonSecondary: {
    backgroundColor: 'rgba(0, 122, 255, 0.15)',
    borderWidth: 2,
    borderColor: 'rgba(0, 122, 255, 0.3)',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  buttonTextSecondary: {
    color: '#007AFF',
  },
  buttonIcon: {
    marginRight: 8,
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
  },
  footerText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
  },
  icon: {
    borderRadius: 4,
  },
});