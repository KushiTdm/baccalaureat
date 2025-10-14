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
      />

      <View style={styles.content}>
        {/* Icône et titre */}
        <Animated.View 
          entering={FadeInDown.delay(200).springify()}
          style={styles.header}
        >
          <Animated.View style={[styles.iconContainer, animatedTitleStyle]}>
            <User size={64} color="#007AFF" />
            <Animated.View 
              entering={BounceIn.delay(600)}
              style={styles.sparkleIcon}
            >
              <Sparkles size={24} color="#FFD700" />
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
            placeholderTextColor="rgba(255, 255, 255, 0.4)"
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
    backgroundColor: '#0a0e27',
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
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 3,
    borderColor: 'rgba(0, 122, 255, 0.3)',
    position: 'relative',
  },
  sparkleIcon: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  title: {
    fontSize: 36,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 12,
    textShadowColor: 'rgba(0, 122, 255, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 24,
  },
  formCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
    padding: 24,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    padding: 16,
    fontSize: 18,
    color: '#fff',
    borderWidth: 2,
    borderColor: 'rgba(0, 122, 255, 0.3)',
    fontWeight: '600',
  },
  hints: {
    marginTop: 16,
    gap: 8,
  },
  hintText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    lineHeight: 18,
  },
  buttonContainer: {
    marginBottom: 24,
  },
  infoCard: {
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.2)',
  },
  infoText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 20,
  },
});