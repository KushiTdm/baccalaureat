//app/results.tsx
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import Animated, { FadeInDown, FadeInUp, BounceIn } from 'react-native-reanimated';
import { useGameStore } from '../store/gameStore';
import Button from '../components/Button';
import { CheckCircle, XCircle, Trophy, RotateCcw } from 'lucide-react-native';
import { colors, radius, spacing, shadow } from '../constants/theme';

export default function ResultsScreen() {
  const router = useRouter();
  const { results, score, resetGame } = useGameStore();

  useEffect(() => {
    if (!results) {
      router.replace('/');
    }
  }, [results, router]);

  if (!results) {
    return null;
  }

  const validAnswers = results.filter((r) => r.isValid).length;
  const totalAnswers = results.filter((r) => r.word.trim() !== '').length;

  function handlePlayAgain() {
    resetGame();
    router.replace('/');
  }

  return (
    <View style={styles.container}>
      <ScrollView
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
            title="Nouvelle partie"
            onPress={handlePlayAgain}
            icon={<RotateCcw size={20} color="#fff" />}
          />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
    fontSize: 34,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.xl,
  },
  scoreContainer: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
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
    fontWeight: '800',
    color: colors.primary,
    lineHeight: 64,
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
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  stats: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  resultsContainer: {
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultCardValid: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSoft,
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
    fontSize: 15,
    fontWeight: '700',
  },
  validPoints: {
    color: colors.success,
  },
  invalidPoints: {
    color: colors.danger,
  },
  noAnswer: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  buttonContainer: {
    marginTop: spacing.sm,
  },
});
