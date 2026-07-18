//app/results.tsx
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import Animated, { FadeInDown, FadeInUp, BounceIn } from 'react-native-reanimated';
import { useGameStore } from '../store/gameStore';
import Button from '../components/Button';
import AdBanner from '../components/AdBanner';
import { maybeShowInterstitial } from '../services/ads';
import { feedback } from '../services/feedback';
import { pickRandomLetter } from '../utils/letters';
import { useSettingsStore } from '../store/settingsStore';
import { CheckCircle, XCircle, Trophy, RotateCcw, Home } from 'lucide-react-native';
import { colors, fonts, radius, spacing, shadow } from '../constants/theme';

export default function ResultsScreen() {
  const router = useRouter();
  const { results, score, resetGame, categories, currentLetter, startGame } = useGameStore();

  // startGame() vide `results` pendant qu'on relance : le garde évite que
  // cet effet ne redirige vers l'accueil en pleine navigation vers /game.
  const replayingRef = useRef(false);
  useEffect(() => {
    if (!results && !replayingRef.current) {
      router.replace('/');
    }
  }, [results, router]);

  // Partie terminée → son/vibration + interstitiel éventuel (toutes les 2-3 parties)
  useEffect(() => {
    if (results) {
      if (score > 0) {
        feedback.victory();
      } else {
        feedback.defeat();
      }
      maybeShowInterstitial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!results) {
    return null;
  }

  const validAnswers = results.filter((r) => r.isValid).length;
  const totalAnswers = results.filter((r) => r.word.trim() !== '').length;

  // Relance directement une manche : nouvelle lettre, mêmes catégories
  function handlePlayAgain() {
    if (categories.length === 0) {
      resetGame();
      router.replace('/');
      return;
    }
    replayingRef.current = true;
    const newLetter = pickRandomLetter(currentLetter ? [currentLetter] : []);
    startGame(newLetter, categories, useSettingsStore.getState().roundDurationSec);
    router.replace('/game');
  }

  function handleGoHome() {
    resetGame();
    router.replace('/');
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={BounceIn.duration(600)} style={styles.header}>
          <View style={styles.trophyCircle}>
            <Trophy size={48} color={colors.gold} />
          </View>
          <Text style={styles.title}>Résultats</Text>
          <View style={styles.scoreContainer}>
            <Text style={styles.scoreLabel}>Score</Text>
            <Text style={styles.score}>{score}</Text>
            <Text style={styles.scoreUnit}>points</Text>
          </View>
          <View style={styles.statsBadge}>
            <CheckCircle size={16} color={colors.success} />
            <Text style={styles.stats}>
              {validAnswers} / {totalAnswers} réponses valides
            </Text>
          </View>
        </Animated.View>

        <View style={styles.resultsContainer}>
          {results.map((result, index) => (
            <Animated.View
              key={index}
              entering={FadeInDown.delay(200 + index * 60).springify()}
              style={[
                styles.resultCard,
                result.isValid ? styles.resultCardValid : result.word ? styles.resultCardInvalid : null,
              ]}
            >
              <View style={styles.resultHeader}>
                <Text style={styles.category}>{result.categorieName}</Text>
                {result.isValid ? (
                  <CheckCircle size={22} color={colors.success} />
                ) : (
                  <XCircle size={22} color={result.word ? colors.danger : colors.textMuted} />
                )}
              </View>

              {result.word ? (
                <View style={styles.answerContainer}>
                  <Text style={styles.word}>{result.word}</Text>
                  <Text
                    style={[
                      styles.points,
                      result.isValid ? styles.validPoints : styles.invalidPoints,
                    ]}
                  >
                    {result.isValid ? `+${result.points}` : '0'} pts
                  </Text>
                </View>
              ) : (
                <Text style={styles.noAnswer}>Pas de réponse</Text>
              )}
            </Animated.View>
          ))}
        </View>

        <Animated.View entering={FadeInUp.delay(400)} style={styles.buttonContainer}>
          <Button
            title="Rejouer"
            onPress={handlePlayAgain}
            icon={<RotateCcw size={20} color={colors.onPrimary} />}
          />
          <Button
            title="Accueil"
            onPress={handleGoHome}
            variant="secondary"
            icon={<Home size={20} color={colors.primary} />}
          />
        </Animated.View>
      </ScrollView>

      <AdBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.xl,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  trophyCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.goldSoft,
    borderWidth: 2,
    borderColor: colors.goldBorder,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
    ...shadow.glow(colors.gold),
  },
  title: {
    fontSize: 32,
    fontFamily: fonts.display,
    color: colors.text,
    marginBottom: spacing.xl,
  },
  scoreContainer: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.lg,
    paddingHorizontal: 44,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    alignItems: 'center',
    ...shadow.card,
  },
  scoreLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  score: {
    fontSize: 56,
    fontFamily: fonts.displayBold,
    color: colors.primary,
    lineHeight: 66,
  },
  scoreUnit: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  statsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  stats: {
    fontSize: 14,
    color: colors.success,
    fontWeight: '700',
  },
  resultsContainer: {
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
    ...shadow.card,
  },
  resultCardValid: {
    borderColor: colors.successSoft,
  },
  resultCardInvalid: {
    borderColor: colors.dangerBorder,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  category: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  answerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  word: {
    fontSize: 18,
    color: colors.text,
    fontWeight: '600',
  },
  points: {
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  validPoints: {
    color: colors.success,
    backgroundColor: colors.successSoft,
  },
  invalidPoints: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  noAnswer: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  buttonContainer: {
    marginTop: spacing.sm,
    gap: spacing.md,
  },
});
