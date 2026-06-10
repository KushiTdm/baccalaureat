// app/online-results.tsx - RÉSULTATS TEMPS RÉEL (socket.io)
// Le scoring vient du serveur via 'all-scores-ready' (stocké dans le gameStore).
// Les manches et l'arrêt de partie passent par socket.io.
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import Animated, { FadeInDown, FadeInUp, BounceIn } from 'react-native-reanimated';
import { useGameStore } from '../store/gameStore';
import Button from '../components/Button';
import { websocketService } from '../services/websocket';
import { CheckCircle, XCircle, Trophy, Crown, Play, StopCircle, Star, Award, Zap } from 'lucide-react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SAFE_AREA_HEIGHT = SCREEN_HEIGHT * 0.25;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

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
    const available = LETTERS.filter((l) => !used.includes(l));
    if (available.length === 0) return LETTERS[Math.floor(Math.random() * LETTERS.length)];
    return available[Math.floor(Math.random() * available.length)];
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
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Animated.View entering={BounceIn.duration(700)} style={styles.winnerSection}>
            {isDraw ? (
              <>
                <Trophy size={80} color="#FFD700" />
                <Text style={styles.winnerText}>Égalité ! 🤝</Text>
              </>
            ) : isWinner ? (
              <>
                <Crown size={80} color="#FFD700" />
                <Text style={styles.winnerText}>Victoire ! 🎉</Text>
              </>
            ) : (
              <>
                <Trophy size={80} color="#999" />
                <Text style={styles.loserText}>Défaite</Text>
                <Text style={styles.winnerName}>{opponentName} gagne !</Text>
              </>
            )}
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.finalScoresCard}>
            <View style={styles.cardHeader}>
              <Award size={24} color="#007AFF" />
              <Text style={styles.sectionTitle}>Score final</Text>
            </View>

            <View style={styles.finalScoresRow}>
              <View style={[styles.finalScoreBlock, isWinner && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>Vous</Text>
                <Text style={styles.finalScoreValue}>{myTotalScore}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color="#FFD700" />
                  <Text style={styles.validCount}>{myWordsTotal} mots</Text>
                </View>
              </View>

              <View style={[styles.finalScoreBlock, !isWinner && !isDraw && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>{opponentName}</Text>
                <Text style={styles.finalScoreValue}>{opponentTotal}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color="#FFD700" />
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
                  icon={<Play size={20} color="#fff" />}
                />
              )}
              <Button
                title="Terminer la partie"
                onPress={handleStopGame}
                variant="secondary"
                icon={<StopCircle size={20} color="#007AFF" />}
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
            <Zap size={24} color="#FFD700" />
            <Text style={styles.scoreLabel}>Score de la manche</Text>
          </View>

          <View style={styles.scoresRow}>
            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>Vous</Text>
              <Text style={styles.scoreValue}>{myFinalScore}</Text>
              <View style={styles.statsRow}>
                <CheckCircle size={16} color="#4caf50" />
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
                <CheckCircle size={16} color="#4caf50" />
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
                          <CheckCircle size={20} color="#4caf50" />
                        ) : (
                          <XCircle size={20} color="#f44336" />
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
                          <CheckCircle size={20} color="#4caf50" />
                        ) : (
                          <XCircle size={20} color="#f44336" />
                        )}
                        <Text style={styles.pointsText}>+{oppAnswer.points}</Text>
                      </View>
                    ) : (
                      <Text style={styles.noAnswer}>-</Text>
                    )}
                  </View>
                </View>
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
          <Button title="Manche suivante" onPress={handleNextRound} icon={<Play size={20} color="#fff" />} />
          <Button
            title="Arrêter la partie"
            onPress={handleStopGame}
            variant="secondary"
            icon={<StopCircle size={20} color="#007AFF" />}
          />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0e27' },
  scrollContent: { padding: 20, paddingTop: 60, paddingBottom: SAFE_AREA_HEIGHT },
  roundHeader: {
    alignItems: 'center',
    marginBottom: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  roundTitle: { fontSize: 32, fontWeight: '800', color: '#fff' },
  letterBadge: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    borderWidth: 2,
    borderColor: '#FFD700',
    justifyContent: 'center',
    alignItems: 'center',
  },
  letterText: { fontSize: 24, fontWeight: '700', color: '#FFD700' },
  scoreCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.3)',
  },
  scoreHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  scoreLabel: { fontSize: 18, fontWeight: '600', color: '#fff' },
  scoresRow: { flexDirection: 'row', gap: 16 },
  scoreBlock: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
  },
  playerLabel: { fontSize: 14, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 8 },
  scoreValue: { fontSize: 48, fontWeight: '800', color: '#007AFF', marginBottom: 8 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  validCount: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)' },
  penaltyText: {
    fontSize: 12,
    color: '#f44336',
    marginTop: 6,
    fontWeight: '700',
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  totalScoreCard: {
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.3)',
  },
  totalScoreLabel: { fontSize: 14, color: 'rgba(255, 255, 255, 0.6)', marginBottom: 8 },
  totalScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  totalScoreValue: { fontSize: 32, fontWeight: '800', color: '#007AFF' },
  totalScoreSeparator: { fontSize: 24, color: 'rgba(255, 255, 255, 0.4)' },
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
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  opponentGoneBanner: {
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 152, 0, 0.3)',
    padding: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  comparisonCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  categoryName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  comparisonRow: { flexDirection: 'row', gap: 12 },
  answerBlock: { flex: 1 },
  answerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: 8,
    borderRadius: 8,
  },
  answerWord: { fontSize: 15, color: '#fff', fontWeight: '600', flex: 1 },
  noAnswer: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.3)',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  pointsText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4caf50',
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  buttonContainer: { gap: 12, marginTop: 8 },
  winnerSection: { alignItems: 'center', marginBottom: 32 },
  winnerText: { fontSize: 36, fontWeight: '800', color: '#4caf50', marginTop: 20 },
  loserText: { fontSize: 32, fontWeight: '700', color: 'rgba(255, 255, 255, 0.6)', marginTop: 16 },
  winnerName: { fontSize: 20, color: '#007AFF', marginTop: 8 },
  finalScoresCard: {
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 24,
    padding: 24,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: 'rgba(0, 122, 255, 0.3)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  winnerBlock: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    borderWidth: 2,
    borderColor: '#4caf50',
  },
  finalScoreValue: { fontSize: 52, fontWeight: '800', color: '#007AFF', marginBottom: 8 },
  historyContainer: { marginBottom: 24 },
  historyCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historyRound: { fontSize: 16, fontWeight: '600', color: '#fff' },
  historyScores: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  historyScore: { fontSize: 14, color: 'rgba(255, 255, 255, 0.7)' },
  waitingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  waitingActions: { marginTop: 32, gap: 12, alignSelf: 'stretch' },
  opponentGoneText: {
    fontSize: 14,
    color: '#ff9800',
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 4,
  },
  waitingTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#fff',
    marginTop: 24,
    textAlign: 'center',
  },
  waitingText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 12,
    textAlign: 'center',
  },
});
