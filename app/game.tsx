//app/game.tsx
import { View, Text, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform, Keyboard, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useRef, useEffect, useCallback } from 'react';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Send } from 'lucide-react-native';
import { useGameStore } from '../store/gameStore';
import { useUserStore } from '../store/userStore';
import { recordSoloGame } from '../services/stats';
import InputWord from '../components/InputWord';
import Timer from '../components/Timer';
import Button from '../components/Button';
import { validateWord } from '../services/api';
import { startsWithLetter } from '../utils/normalize';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, fonts, radius, spacing, shadow } from '../constants/theme';

export default function GameScreen() {
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const {
    currentLetter,
    categories,
    answers,
    setAnswer,
    setResults,
    setScore,
    endGame,
  } = useGameStore();

  const [submitting, setSubmitting] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  // Ref (et pas seulement state) : le timer et le bouton peuvent déclencher
  // la soumission dans le même tick → une seule doit passer.
  const submittedRef = useRef(false);

  // ⚠️ Tous les hooks AVANT tout early-return : un return conditionnel placé
  // avant un useEffect fait crasher React ("Rendered fewer hooks") quand
  // resetGame() vide le store alors que cet écran est encore monté.
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, []);

  const shouldRedirect = !currentLetter || categories.length === 0;
  useEffect(() => {
    if (shouldRedirect) {
      router.replace('/');
    }
  }, [shouldRedirect, router]);

  const handleSubmit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    endGame();

    const state = useGameStore.getState();
    const letter = state.currentLetter;

    try {
      const validationPromises = state.categories.map(async (category) => {
        const answer = state.answers.find((a) => a.categorieId === category.id);
        const word = answer?.word || '';

        if (!word.trim() || !letter || !startsWithLetter(word, letter)) {
          return {
            categorieId: category.id,
            categorieName: category.nom,
            word: word.trim(),
            isValid: false,
            points: 0,
          };
        }

        try {
          const isValid = await validateWord(word, category.id);
          return {
            categorieId: category.id,
            categorieName: category.nom,
            word,
            isValid,
            points: isValid ? 10 : 0,
          };
        } catch (error) {
          console.error(`Erreur validation pour ${category.nom}:`, error);
          return {
            categorieId: category.id,
            categorieName: category.nom,
            word,
            isValid: false,
            points: 0,
          };
        }
      });

      const results = await Promise.all(validationPromises);
      const totalScore = results.reduce((sum, r) => sum + r.points, 0);

      setResults(results);
      setScore(totalScore);

      // Historique : sauvegarde en arrière-plan, jamais bloquante
      recordSoloGame(useUserStore.getState().user?.id, letter || '', totalScore, results);

      // replace : le retour arrière ne doit pas ramener sur une manche terminée
      router.replace('/results');
    } catch (error) {
      submittedRef.current = false;
      Alert.alert('Erreur', 'Impossible de valider les réponses');
    } finally {
      setSubmitting(false);
    }
  }, [endGame, setResults, setScore, router]);

  const handleTimeUp = useCallback(() => {
    handleSubmit();
  }, [handleSubmit]);

  if (shouldRedirect) {
    return null;
  }

  const filledCount = answers.filter((a) => a.word.trim() !== '').length;
  const progressPercent = categories.length > 0 ? (filledCount / categories.length) * 100 : 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={styles.container}>
        <Animated.View entering={FadeIn.duration(400)} style={styles.header}>
          <View style={styles.headerRow}>
            <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.letterRow}>
              <View style={styles.letterCircle}>
                <Text style={styles.letter}>{currentLetter!.toUpperCase()}</Text>
              </View>
              <Text style={styles.filledText}>
                {filledCount} / {categories.length} remplis
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(200).springify()}>
              <Timer onTimeUp={handleTimeUp} compact />
            </Animated.View>
          </View>

          <Animated.View entering={FadeInUp.delay(300)} style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <LinearGradient
                colors={gradients.timer}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.progressFill, { width: `${progressPercent}%` }]}
              />
            </View>
          </Animated.View>
        </Animated.View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            keyboardVisible && styles.scrollContentKeyboardVisible
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {categories.map((category, index) => {
            const answer = answers.find((a) => a.categorieId === category.id);
            return (
              <InputWord
                key={category.id}
                ref={(el) => { inputRefs.current[index] = el; }}
                index={index}
                category={category.nom}
                value={answer?.word || ''}
                onChangeText={(text) => setAnswer(category.id, text)}
                letter={currentLetter!}
                editable={!submitting}
                isLast={index === categories.length - 1}
                onSubmitNext={() => inputRefs.current[index + 1]?.focus()}
              />
            );
          })}

          <View style={styles.submitContainer}>
            <Button
              title={submitting ? 'Validation...' : 'Terminer la partie'}
              onPress={handleSubmit}
              loading={submitting}
              icon={<Send size={20} color={colors.onPrimary} />}
            />
          </View>

          {/* Espace supplémentaire pour le clavier */}
          <View style={styles.keyboardSpacer} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Design "Variante A" : en-tête posé sur le fond, sans carte
  header: {
    backgroundColor: colors.bg,
    paddingTop: 60,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  // Cercle-lettre + "X / Y remplis" alignés sur une ligne (maquette "Variante A")
  letterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  letterCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow.card,
  },
  letter: {
    fontSize: 22,
    fontFamily: fonts.displayBold,
    color: colors.primary,
  },
  filledText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  progressContainer: {
    gap: spacing.sm,
  },
  progressBar: {
    height: 7,
    backgroundColor: colors.bgDeep,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.xl,
    paddingBottom: 40,
  },
  scrollContentKeyboardVisible: {
    paddingBottom: 300, // Espace pour le clavier
  },
  submitContainer: {
    marginTop: spacing.xl,
  },
  keyboardSpacer: {
    height: 250, // Espace supplémentaire pour scroller sous le clavier
  },
});
