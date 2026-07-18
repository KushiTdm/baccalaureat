// app/online-results.tsx - RÉSULTATS TEMPS RÉEL (socket.io)
// Le scoring vient du serveur via 'all-scores-ready' (stocké dans le gameStore).
// Les manches et l'arrêt de partie passent par socket.io.
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import Animated, { FadeInDown, FadeInUp, BounceIn } from 'react-native-reanimated';
import { useGameStore } from '../store/gameStore';
import { useUserStore } from '../store/userStore';
import { recordOnlineGame } from '../services/stats';
import Button from '../components/Button';
import AdBanner from '../components/AdBanner';
import { maybeShowInterstitial } from '../services/ads';
import { feedback } from '../services/feedback';
import { websocketService } from '../services/websocket';
import { pickRandomLetter } from '../utils/letters';
import { normalizeWord } from '../utils/normalize';
import { CheckCircle, XCircle, Trophy, Crown, Play, StopCircle, Star, Award, Zap } from 'lucide-react-native';
import { colors, fonts, radius, spacing, shadow } from '../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SAFE_AREA_HEIGHT = SCREEN_HEIGHT * 0.25;

export default function OnlineResultsScreen() {
  const router = useRouter();

  const {
    results,
    score,
    opponentResults,
    opponentScore,
    opponentName,
    categories,
    currentRound,
    currentLetter,
    roundHistory,
    addRoundToHistory,
    startNewRound,
    resetGame,
    isHost,
    stoppedEarly,
  } = useGameStore();

  const [showFinalResults, setShowFinalResults] = useState(false);
  const [waitingForNextRound, setWaitingForNextRound] = useState(false);
  const [opponentGone, setOpponentGone] = useState(false);

  // Partie terminée (écran final uniquement) → interstitiel + stats/ELO
  const statsRecordedRef = useRef(false);
  useEffect(() => {
    if (!showFinalResults || statsRecordedRef.current) return;
    statsRecordedRef.current = true;

    maybeShowInterstitial();

    const s = useGameStore.getState();
    const myTotal = s.roundHistory.reduce((sum, r) => sum + r.myScore, 0);
    const oppTotal = s.roundHistory.reduce((sum, r) => sum + r.opponentScore, 0);

    // Son/vibration de fin de partie (rien en cas d'égalité)
    if (myTotal > oppTotal) {
      feedback.victory();
    } else if (myTotal < oppTotal) {
      feedback.defeat();
    }

    recordOnlineGame({
      userId: useUserStore.getState().user?.id,
      myPlayerId: websocketService.getCurrentPlayerId(),
      myScore: myTotal,
      opponentScore: oppTotal,
      roundsPlayed: s.roundHistory.length,
      validWords: s.roundHistory.reduce((sum, r) => sum + r.myValidWords, 0),
      bestRoundScore: s.roundHistory.reduce((max, r) => Math.max(max, r.myScore), 0),
    });
  }, [showFinalResults]);

  const committedRef = useRef(false);
  const navigatedRef = useRef(false);

  const playerId = websocketService.getCurrentPlayerId();

  const myResults = results || [];
  const oppResults = opponentResults || [];

  const myFinalScore = score || 0;
  const opponentFinalScore = opponentScore || 0;
  const myValid = myResults.filter((r) => r.isValid).length;
  const oppValid = oppResults.filter((r) => r.isValid).length;

  // Verrou : enregistre la manche courante dans l'historique une seule fois
  const commitRoundToHistory = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    addRoundToHistory({
      roundNumber: currentRound,
      letter: currentLetter || '',
      myScore: myFinalScore,
      opponentScore: opponentFinalScore,
      myValidWords: myValid,
      opponentValidWords: oppValid,
    });
  };

  useEffect(() => {
    if (!results) {
      router.replace('/');
      return;
    }

    // Les callbacks de l'écran de jeu (démonté) ne doivent plus réagir ici
    websocketService.clearCallbacks();
    websocketService.setCallbacks({
      // L'hôte (ou n'importe qui) a lancé la manche suivante → tout le monde y va
      onNewRound: (data) => {
        if (navigatedRef.current) return;
        navigatedRef.current = true;
        commitRoundToHistory();
        const s = useGameStore.getState();
        // Numéro de manche + horloge synchronisés sur le serveur
        s.startNewRound(data.letter, data.roundNumber);
        if (data.roundDuration) {
          const elapsedSec = data.startedAt
            ? Math.max(0, (data.timestamp - data.startedAt) / 1000)
            : 0;
          s.syncRoundClock(data.roundDuration, elapsedSec);
        }
        router.replace('/online-game');
      },
      // Fin de partie demandée → écran final pour tous
      onGameEnded: () => {
        commitRoundToHistory();
        setShowFinalResults(true);
      },
      // Si l'hôte part, le serveur me promeut : je peux lancer la suite
      onHostChanged: (data) => {
        if (data.newHostId === playerId) {
          useGameStore.getState().setIsHost(true);
        }
      },
      onPlayerDisconnected: () => setOpponentGone(true),
      onPlayerLeft: () => setOpponentGone(true),
      onPlayerJoined: () => setOpponentGone(false),
    });

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getNewLetter = () => {
    const used = roundHistory.map((r) => r.letter);
    if (currentLetter) used.push(currentLetter);
    return pickRandomLetter(used);
  };

  const handleNextRound = () => {
    setWaitingForNextRound(true);
    if (isHost) {
      // L'hôte choisit la lettre et déclenche ; onNewRound fera naviguer tout le monde
      websocketService.nextRound(getNewLetter());
    }
    // Le non-hôte attend simplement le 'new-round' du serveur
  };

  const handleStopGame = () => {
    commitRoundToHistory();
    websocketService.endGame(); // serveur → 'game-ended' à tous
    setShowFinalResults(true);
  };

  const handleNewGame = () => {
    websocketService.disconnect();
    resetGame();
    router.replace('/');
  };

  if (!results) {
    return null;
  }

  // Totaux cumulés calculés UNIQUEMENT depuis l'historique (source unique)
  const histMy = roundHistory.reduce((s, r) => s + r.myScore, 0);
  const histOpp = roundHistory.reduce((s, r) => s + r.opponentScore, 0);
  // Sur l'écran final, la manche courante est déjà committée dans l'historique
  const myTotalScore = showFinalResults ? histMy : histMy + myFinalScore;
  const opponentTotal = showFinalResults ? histOpp : histOpp + opponentFinalScore;

  // ---------- ÉCRAN FINAL ----------
  if (showFinalResults) {
    const isWinner = myTotalScore > opponentTotal;
    const isDraw = myTotalScore === opponentTotal;
    const myWordsTotal = roundHistory.reduce((s, r) => s + r.myValidWords, 0);
    const oppWordsTotal = roundHistory.reduce((s, r) => s + r.opponentValidWords, 0);

    return (
      <View style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Animated.View entering={BounceIn.duration(700)} style={styles.winnerSection}>
            {isDraw ? (
              <>
                <Trophy size={80} color={colors.gold} />
                <Text style={styles.winnerText}>Égalité ! 🤝</Text>
              </>
            ) : isWinner ? (
              <>
                <Crown size={80} color={colors.gold} />
                <Text style={styles.winnerText}>Victoire ! 🎉</Text>
              </>
            ) : (
              <>
                <Trophy size={80} color={colors.textMuted} />
                <Text style={styles.loserText}>Défaite</Text>
                <Text style={styles.winnerName}>{opponentName} gagne !</Text>
              </>
            )}
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.finalScoresCard}>
            <View style={styles.cardHeader}>
              <Award size={24} color={colors.primary} />
              <Text style={styles.sectionTitle}>Score final</Text>
            </View>

            <View style={styles.finalScoresRow}>
              <View style={[styles.finalScoreBlock, isWinner && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>Vous</Text>
                <Text style={styles.finalScoreValue}>{myTotalScore}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color={colors.gold} />
                  <Text style={styles.validCount}>{myWordsTotal} mots</Text>
                </View>
              </View>

              <View style={[styles.finalScoreBlock, !isWinner && !isDraw && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>{opponentName}</Text>
                <Text style={styles.finalScoreValue}>{opponentTotal}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color={colors.gold} />
                  <Text style={styles.validCount}>{oppWordsTotal} mots</Text>
                </View>
              </View>
            </View>
          </Animated.View>

          <View style={styles.historyContainer}>
            <Text style={styles.sectionTitle}>Historique ({roundHistory.length} manches)</Text>
            {roundHistory.map((round, index) => (
              <Animated.View
                key={index}
                entering={FadeInDown.delay(300 + index * 80).springify()}
                style={styles.historyCard}
              >
                <View style={styles.historyHeader}>
                  <Text style={styles.historyRound}>Manche {round.roundNumber}</Text>
                  <View style={styles.letterBadge}>
                    <Text style={styles.letterText}>{round.letter}</Text>
                  </View>
                </View>
                <View style={styles.historyScores}>
                  <Text style={styles.historyScore}>Vous: {round.myScore}pts</Text>
                  <Text style={styles.historyScore}>{opponentName}: {round.opponentScore}pts</Text>
                </View>
              </Animated.View>
            ))}
          </View>

          <Animated.View entering={FadeInUp.delay(400)} style={styles.buttonContainer}>
            <Button title="Nouvelle partie" onPress={handleNewGame} />
          </Animated.View>
        </ScrollView>

        <AdBanner />
      </View>
    );
  }

  // ---------- ÉCRAN D'ATTENTE MANCHE SUIVANTE ----------
  if (waitingForNextRound) {
    return (
      <View style={styles.container}>
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingTitle}>
            {isHost ? 'Lancement de la manche...' : "En attente de l'hôte..."}
          </Text>
          <Text style={styles.waitingText}>
            {isHost ? 'Préparation de la nouvelle manche' : `${opponentName} prépare la prochaine manche`}
          </Text>

          {opponentGone && (
            <View style={styles.waitingActions}>
              <Text style={styles.opponentGoneText}>
                ⚠️ {opponentName} semble avoir quitté la partie.
              </Text>
              {isHost && (
                <Button
                  title="Relancer la manche"
                  onPress={() => websocketService.nextRound(getNewLetter())}
                  icon={<Play size={20} color={colors.onPrimary} />}
                />
              )}
              <Button
                title="Terminer la partie"
                onPress={handleStopGame}
                variant="secondary"
                icon={<StopCircle size={20} color={colors.primary} />}
              />
            </View>
          )}
        </View>
      </View>
    );
  }

  // ---------- RÉSULTATS DE LA MANCHE ----------
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(400)} style={styles.roundHeader}>
          <Text style={styles.roundTitle}>Manche {currentRound}</Text>
          <View style={styles.letterBadge}>
            <Text style={styles.letterText}>{currentLetter}</Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.scoreCard}>
          <View style={styles.scoreHeader}>
            <Zap size={24} color={colors.gold} />
            <Text style={styles.scoreLabel}>Score de la manche</Text>
          </View>

          <View style={styles.scoresRow}>
            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>Vous</Text>
              <Text style={styles.scoreValue}>{myFinalScore}</Text>
              <View style={styles.statsRow}>
                <CheckCircle size={16} color={colors.success} />
                <Text style={styles.validCount}>{myValid} valides</Text>
              </View>
              {stoppedEarly && myResults.some((r) => r.word && !r.isValid) && (
                <Text style={styles.penaltyText}>⚠️ -3pts (pénalité)</Text>
              )}
            </View>

            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>{opponentName}</Text>
              <Text style={styles.scoreValue}>{opponentFinalScore}</Text>
              <View style={styles.statsRow}>
                <CheckCircle size={16} color={colors.success} />
                <Text style={styles.validCount}>{oppValid} valides</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.totalScoreCard}>
          <Text style={styles.totalScoreLabel}>Score total</Text>
          <View style={styles.totalScoreRow}>
            <Text style={styles.totalScoreValue}>{myTotalScore}</Text>
            <Text style={styles.totalScoreSeparator}>-</Text>
            <Text style={styles.totalScoreValue}>{opponentTotal}</Text>
          </View>
        </Animated.View>

        <View style={styles.comparisonContainer}>
          <Text style={styles.sectionTitle}>Réponses</Text>
          <View style={styles.comparisonLegend}>
            <Text style={styles.legendText}>Vous</Text>
            <Text style={styles.legendText}>{opponentName}</Text>
          </View>
          {categories.map((category, index) => {
            const myAnswer = myResults.find((r) => r.categorieId === category.id);
            const oppAnswer = oppResults.find((r) => r.categorieId === category.id);
            // Règle Petit Bac : même mot valide chez les deux → points partagés
            const isDuplicate = !!(
              myAnswer?.word && oppAnswer?.word &&
              myAnswer.isValid && oppAnswer.isValid &&
              normalizeWord(myAnswer.word) === normalizeWord(oppAnswer.word)
            );
            return (
              <Animated.View
                key={category.id ?? index}
                entering={FadeInDown.delay(250 + index * 60).springify()}
                style={styles.comparisonCard}
              >
                <Text style={styles.categoryName}>{category.nom}</Text>
                <View style={styles.comparisonRow}>
                  <View style={styles.answerBlock}>
                    {myAnswer?.word ? (
                      <View style={styles.answerContainer}>
                        <Text style={styles.answerWord}>{myAnswer.word}</Text>
                        {myAnswer.isValid ? (
                          <CheckCircle size={20} color={colors.success} />
                        ) : (
                          <XCircle size={20} color={colors.danger} />
                        )}
                        <Text style={styles.pointsText}>+{myAnswer.points}</Text>
                      </View>
                    ) : (
                      <Text style={styles.noAnswer}>-</Text>
                    )}
                  </View>

                  <View style={styles.answerBlock}>
                    {oppAnswer?.word ? (
                      <View style={styles.answerContainer}>
                        <Text style={styles.answerWord}>{oppAnswer.word}</Text>
                        {oppAnswer.isValid ? (
                          <CheckCircle size={20} color={colors.success} />
                        ) : (
                          <XCircle size={20} color={colors.danger} />
                        )}
                        <Text style={styles.pointsText}>+{oppAnswer.points}</Text>
                      </View>
                    ) : (
                      <Text style={styles.noAnswer}>-</Text>
                    )}
                  </View>
                </View>
                {isDuplicate && (
                  <View style={styles.duplicateBadge}>
                    <Text style={styles.duplicateText}>🤝 Mots identiques — points partagés</Text>
                  </View>
                )}
              </Animated.View>
            );
          })}
        </View>

        {opponentGone && (
          <View style={styles.opponentGoneBanner}>
            <Text style={styles.opponentGoneText}>
              ⚠️ {opponentName} semble avoir quitté la partie.
            </Text>
          </View>
        )}

        <Animated.View entering={FadeInUp.delay(400)} style={styles.buttonContainer}>
          <Button title="Manche suivante" onPress={handleNextRound} icon={<Play size={20} color={colors.onPrimary} />} />
          <Button
            title="Arrêter la partie"
            onPress={handleStopGame}
            variant="secondary"
            icon={<StopCircle size={20} color={colors.primary} />}
          />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingTop: 60, paddingBottom: SAFE_AREA_HEIGHT },
  roundHeader: {
    alignItems: 'center',
    marginBottom: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  roundTitle: { fontSize: 30, fontFamily: fonts.display, color: colors.text },
  letterBadge: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.goldSoft,
    borderWidth: 2,
    borderColor: colors.goldBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  letterText: { fontSize: 24, fontFamily: fonts.displayBold, color: colors.goldDeep },
  scoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 24,
    marginBottom: 16,
    ...shadow.card,
  },
  scoreHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  scoreLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
  scoresRow: { flexDirection: 'row', gap: 16 },
  scoreBlock: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: 16,
  },
  playerLabel: { fontSize: 14, color: colors.textSecondary, marginBottom: 8, fontWeight: '600' },
  scoreValue: { fontSize: 48, fontFamily: fonts.displayBold, color: colors.primary, marginBottom: 8 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  validCount: { fontSize: 13, color: colors.textSecondary },
  penaltyText: {
    fontSize: 12,
    color: colors.danger,
    marginTop: 6,
    fontWeight: '700',
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  totalScoreCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 24,
    alignItems: 'center',
  },
  totalScoreLabel: { fontSize: 14, color: colors.textSecondary, marginBottom: 8, fontWeight: '600' },
  totalScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  totalScoreValue: { fontSize: 32, fontFamily: fonts.displayBold, color: colors.primary },
  totalScoreSeparator: { fontSize: 24, color: colors.textMuted },
  comparisonContainer: { marginBottom: 24 },
  comparisonLegend: {
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 16,
    gap: 12,
  },
  legendText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  opponentGoneBanner: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    padding: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: fonts.display,
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  comparisonCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    ...shadow.card,
  },
  categoryName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 12,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  comparisonRow: { flexDirection: 'row', gap: 12 },
  duplicateBadge: {
    marginTop: 10,
    alignSelf: 'center',
    backgroundColor: colors.goldDeepSoft,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  duplicateText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.goldDeep,
  },
  answerBlock: { flex: 1 },
  answerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bg,
    padding: 8,
    borderRadius: 8,
  },
  answerWord: { fontSize: 15, color: colors.text, fontWeight: '600', flex: 1 },
  noAnswer: {
    fontSize: 16,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  pointsText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.success,
    backgroundColor: colors.successSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  buttonContainer: { gap: 12, marginTop: 8 },
  winnerSection: { alignItems: 'center', marginBottom: 32 },
  winnerText: { fontSize: 34, fontFamily: fonts.displayBold, color: colors.success, marginTop: 20 },
  loserText: { fontSize: 30, fontFamily: fonts.display, color: colors.textSecondary, marginTop: 16 },
  winnerName: { fontSize: 20, color: colors.primary, marginTop: 8, fontWeight: '600' },
  finalScoresCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 24,
    marginBottom: 24,
    ...shadow.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  finalScoresRow: { flexDirection: 'row', gap: 16 },
  finalScoreBlock: {
    flex: 1,
    alignItems: 'center',
    padding: 20,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  winnerBlock: {
    backgroundColor: colors.successSoft,
    borderWidth: 2,
    borderColor: colors.success,
  },
  finalScoreValue: { fontSize: 52, fontFamily: fonts.displayBold, color: colors.primary, marginBottom: 8 },
  historyContainer: { marginBottom: 24 },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    ...shadow.card,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historyRound: { fontSize: 16, fontWeight: '600', color: colors.text },
  historyScores: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  historyScore: { fontSize: 14, color: colors.textSecondary },
  waitingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  waitingActions: { marginTop: 32, gap: 12, alignSelf: 'stretch' },
  opponentGoneText: {
    fontSize: 14,
    color: colors.goldDeep,
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 4,
  },
  waitingTitle: {
    fontSize: 26,
    fontFamily: fonts.display,
    color: colors.text,
    marginTop: 24,
    textAlign: 'center',
  },
  waitingText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 12,
    textAlign: 'center',
  },
});
