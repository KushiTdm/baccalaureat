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
import { CheckCircle, Trophy, RotateCcw, Home } from 'lucide-react-native';
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
          <Text style={styles.meta}>
            Manche terminée{currentLetter ? ` · Lettre ${currentLetter.toUpperCase()}` : ''}
          </Text>
          <View style={styles.headlineRow}>
            <Trophy size={26} color={colors.gold} />
            <Text style={styles.title}>{score > 0 ? 'Bien joué !' : 'Manche terminée'}</Text>
          </View>
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

        {/* Détail par catégorie : une seule carte, lignes séparées par un filet (maquette) */}
        <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.detailCard}>
          <Text style={styles.detailTitle}>Détail</Text>
          {results.map((result, index) => {
            const pointsLabel = result.isValid ? `+${result.points}` : '0';
            const pointsStyle = result.isValid
              ? styles.detailPointsValid
              : result.word
                ? styles.detailPointsInvalid
                : styles.detailPointsEmpty;
            return (
              <View
                key={index}
                style={[
                  styles.detailRow,
                  index === results.length - 1 && styles.detailRowLast,
                ]}
              >
                <Text style={styles.detailCategory} numberOfLines={1}>
                  {result.categorieName}
                </Text>
                <View style={styles.detailAnswerGroup}>
                  <Text
                    style={result.word ? styles.detailWord : styles.detailWordEmpty}
                    numberOfLines={1}
                  >
                    {result.word || '—'}
                  </Text>
                  <Text style={[styles.detailPoints, pointsStyle]}>{pointsLabel}</Text>
                </View>
              </View>
            );
          })}
        </Animated.View>

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
  meta: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: 28,
    fontFamily: fonts.displayBold,
    color: colors.text,
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
  // Détail : une seule carte, lignes séparées par un filet (maquette "Résultats")
  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginBottom: spacing.xxl,
    ...shadow.card,
  },
  detailTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingVertical: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: colors.borderLight,
    gap: spacing.md,
  },
  detailRowLast: {
    paddingBottom: spacing.sm,
  },
  detailCategory: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  detailAnswerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '62%',
  },
  detailWord: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '700',
    flexShrink: 1,
  },
  detailWordEmpty: {
    fontSize: 16,
    color: colors.textMuted,
    flexShrink: 1,
  },
  detailPoints: {
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
    textAlign: 'center',
    minWidth: 38,
  },
  detailPointsValid: {
    color: colors.success,
    backgroundColor: colors.successSoft,
  },
  detailPointsInvalid: {
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  detailPointsEmpty: {
    color: colors.textMuted,
    backgroundColor: colors.surfaceStrong,
  },
  buttonContainer: {
    marginTop: spacing.sm,
    gap: spacing.md,
  },
});
