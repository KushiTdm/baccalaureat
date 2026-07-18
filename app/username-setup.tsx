// app/username-setup.tsx
import { View, Text, StyleSheet, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useUserStore } from '../store/userStore';
import Button from '../components/Button';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  BounceIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { User, Sparkles } from 'lucide-react-native';
import { useEffect } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, fonts, radius, spacing, shadow } from '../constants/theme';

export default function UsernameSetupScreen() {
  const router = useRouter();
  const { setUsername } = useUserStore();
  const [username, setUsernameInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Animation du titre
  const scaleAnim = useSharedValue(1);

  useEffect(() => {
    scaleAnim.value = withRepeat(
      withSequence(
        withSpring(1.1, { damping: 2 }),
        withSpring(1, { damping: 2 })
      ),
      -1,
      true
    );
  }, []);

  const animatedTitleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleAnim.value }],
  }));

  async function handleSubmit() {
    if (!username.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer un pseudo');
      return;
    }

    if (username.trim().length < 3) {
      Alert.alert('Erreur', 'Le pseudo doit contenir au moins 3 caractères');
      return;
    }

    if (username.length > 20) {
      Alert.alert('Erreur', 'Le pseudo ne peut pas dépasser 20 caractères');
      return;
    }

    setLoading(true);
    try {
      await setUsername(username.trim());
      
      // Rediriger vers l'écran d'accueil
      router.replace('/');
    } catch (error: any) {
      console.error('Erreur:', error);
      Alert.alert(
        'Erreur',
        error.message || 'Impossible de définir le pseudo'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Animated.View
        entering={FadeIn.duration(800)}
        style={styles.backgroundGradient}
      >
        <LinearGradient
          colors={gradients.onboarding}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.7, y: 1 }}
          style={styles.gradientFill}
        />
      </Animated.View>

      <View style={styles.content}>
        {/* Icône et titre */}
        <Animated.View 
          entering={FadeInDown.delay(200).springify()}
          style={styles.header}
        >
          <Animated.View style={[styles.iconContainer, animatedTitleStyle]}>
            <User size={64} color={colors.primary} />
            <Animated.View
              entering={BounceIn.delay(600)}
              style={styles.sparkleIcon}
            >
              <Sparkles size={24} color={colors.gold} />
            </Animated.View>
          </Animated.View>

          <Text style={styles.title}>Bienvenue !</Text>
          <Text style={styles.subtitle}>
            Choisissez un pseudo pour commencer
          </Text>
        </Animated.View>

        {/* Formulaire */}
        <Animated.View 
          entering={FadeInUp.delay(400).springify()}
          style={styles.formCard}
        >
          <Text style={styles.label}>Votre pseudo</Text>
          
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsernameInput}
            placeholder="Ex: JoueurPro42"
            placeholderTextColor={colors.textMuted}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={handleSubmit}
          />

          <View style={styles.hints}>
            <Text style={styles.hintText}>✓ Entre 3 et 20 caractères</Text>
            <Text style={styles.hintText}>✓ Unique et facile à retenir</Text>
            <Text style={styles.hintText}>✓ Vous pourrez le modifier plus tard</Text>
          </View>
        </Animated.View>

        {/* Boutons */}
        <Animated.View 
          entering={FadeInUp.delay(600)}
          style={styles.buttonContainer}
        >
          <Button
            title={loading ? 'Création...' : 'Commencer à jouer'}
            onPress={handleSubmit}
            variant="secondary"
            loading={loading}
            disabled={!username.trim() || username.trim().length < 3}
          />
        </Animated.View>

        {/* Info supplémentaire */}
        <Animated.View 
          entering={FadeIn.delay(800)}
          style={styles.infoCard}
        >
          <Text style={styles.infoText}>
            💡 Votre progression sera automatiquement sauvegardée sur cet appareil
          </Text>
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Écran onboarding du design : plein écran dégradé indigo
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gradientFill: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  // Tuile logo blanche du design (lettre/icône indigo)
  iconContainer: {
    width: 112,
    height: 112,
    borderRadius: 30,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    position: 'relative',
    ...shadow.card,
  },
  sparkleIcon: {
    position: 'absolute',
    top: -6,
    right: -6,
  },
  title: {
    fontSize: 38,
    fontFamily: fonts.displayBold,
    color: colors.onPrimary,
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 17,
    color: colors.onPrimarySecondary,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 25,
  },
  formCard: {
    backgroundColor: colors.onPrimarySurface,
    borderRadius: radius.xl,
    padding: 24,
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onPrimarySecondary,
    marginBottom: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    fontSize: 18,
    color: colors.text,
    fontWeight: '600',
  },
  hints: {
    marginTop: 16,
    gap: 8,
  },
  hintText: {
    fontSize: 13,
    color: colors.onPrimaryMuted,
    lineHeight: 18,
  },
  buttonContainer: {
    marginBottom: 24,
  },
  infoCard: {
    backgroundColor: colors.onPrimarySurface,
    borderRadius: radius.md,
    padding: 16,
  },
  infoText: {
    fontSize: 13,
    color: colors.onPrimarySecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});