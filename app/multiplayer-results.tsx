// app/multiplayer-results.tsx - VERSION COMPLÈTE "PETIT BAC"
import { View, Text, StyleSheet, ScrollView, Alert, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import Button from '../components/Button';
import { bluetoothService, GameMessage } from '../services/bluetooth';
import { GameResult, RoundHistory } from '../store/gameStore';
import { getCategories } from '../services/api';
import { CheckCircle, XCircle, Trophy, Crown, Play, StopCircle, Star, Award, Zap } from 'lucide-react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SAFE_AREA_HEIGHT = SCREEN_HEIGHT * 0.25;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function MultiplayerResultsScreen() {
  const router = useRouter();
  const {
    results,
    score,
    opponentResults: storedOpponentResults,
    opponentScore: storedOpponentScore,
    opponentName,
    categories,
    currentRound,
    totalScore,
    opponentTotalScore,
    roundHistory,
    addRoundToHistory,
    updateTotalScores,
    startNewRound,
    startMultiplayerGame,
    resetGame,
    currentLetter,
    isHost,
    stoppedEarly,
  } = useGameStore();

  const [opponentResults, setOpponentResults] = useState<GameResult[]>(storedOpponentResults || []);
  const [opponentScore, setOpponentScore] = useState(storedOpponentScore || 0);
  const [opponentStoppedEarly, setOpponentStoppedEarly] = useState(false);
  const [loading, setLoading] = useState(!storedOpponentResults);
  const [showFinalResults, setShowFinalResults] = useState(false);
  const [waitingForNextRound, setWaitingForNextRound] = useState(false);

  const resultsReceivedRef = useRef(false);
  const opponentReadyRef = useRef(false);
  const iAmReadyRef = useRef(false);

  useEffect(() => {
    // Écouter les messages de l'adversaire
    const handleOpponentMessage = (message: GameMessage) => {
      if (message.type === 'ANSWER_SUBMIT' && !resultsReceivedRef.current) {
        resultsReceivedRef.current = true;
        setOpponentResults(message.data.results);
        setOpponentScore(message.data.score || 0);
        setOpponentStoppedEarly(message.data.stoppedEarly || false);
        setLoading(false);
      } else if (message.type === 'NEXT_ROUND') {
        // L'adversaire est prêt pour la manche suivante
        opponentReadyRef.current = true;
        if (iAmReadyRef.current) {
          startNextRound(message.data.letter);
        }
      } else if (message.type === 'FINISH_GAME') {
        // L'adversaire veut arrêter
        setShowFinalResults(true);
      }
    };

    bluetoothService.setMessageListener(handleOpponentMessage);

    // Si on a déjà les résultats, pas besoin d'attendre
    if (storedOpponentResults && storedOpponentResults.length > 0) {
      setLoading(false);
    }

    return () => {
      // Garder le listener actif
    };
  }, [storedOpponentResults]);

  // Calculer les scores finaux avec pénalités
  const calculateFinalScore = (gameResults: GameResult[], didStopEarly: boolean) => {
    const totalPoints = gameResults.reduce((sum, r) => sum + r.points, 0);
    const allFieldsFilled = gameResults.every(r => r.word.trim() !== '');
    const hasInvalidWord = gameResults.some(r => r.word.trim() !== '' && !r.isValid);
    
    // Pénalité si on a arrêté le jeu ET qu'on a des erreurs
    if (didStopEarly && allFieldsFilled && hasInvalidWord) {
      return Math.max(0, totalPoints - 3);
    }
    return totalPoints;
  };

  const myFinalScore = results ? calculateFinalScore(results, stoppedEarly || false) : 0;
  const opponentFinalScore = calculateFinalScore(opponentResults, opponentStoppedEarly);

  // Ajouter cette manche à l'historique
  useEffect(() => {
    if (!loading && results && opponentResults.length > 0) {
      const roundData: RoundHistory = {
        roundNumber: currentRound,
        letter: currentLetter || '',
        myScore: myFinalScore,
        opponentScore: opponentFinalScore,
        myValidWords: results.filter(r => r.isValid).length,
        opponentValidWords: opponentResults.filter(r => r.isValid).length,
      };
      
      // Éviter les doublons
      if (!roundHistory.find(r => r.roundNumber === currentRound)) {
        addRoundToHistory(roundData);
        updateTotalScores(myFinalScore, opponentFinalScore);
      }
    }
  }, [loading, results, opponentResults]);

  // Générer une nouvelle lettre
  const getNewLetter = () => {
    const usedLetters = roundHistory.map(r => r.letter);
    const availableLetters = LETTERS.filter(l => !usedLetters.includes(l));
    if (availableLetters.length === 0) {
      return LETTERS[Math.floor(Math.random() * LETTERS.length)];
    }
    return availableLetters[Math.floor(Math.random() * availableLetters.length)];
  };

  // Démarrer la manche suivante
  const startNextRound = async (letter?: string) => {
    const newLetter = letter || getNewLetter();
    const cats = categories.length > 0 ? categories : await getCategories();
    
    startNewRound(newLetter);
    
    if (opponentName) {
      startMultiplayerGame(newLetter, cats, isHost, opponentName);
    }
    
    router.replace('/multiplayer-game');
  };

  // Gérer le clic sur "Manche suivante"
  const handleNextRound = async () => {
    if (!isHost) {
      // Si je ne suis pas l'hôte, j'envoie juste mon ready
      iAmReadyRef.current = true;
      await bluetoothService.sendMessage({
        type: 'NEXT_ROUND',
        data: { ready: true },
      });
      setWaitingForNextRound(true);
      return;
    }

    // Si je suis l'hôte, je génère la nouvelle lettre et l'envoie
    const newLetter = getNewLetter();
    
    iAmReadyRef.current = true;
    await bluetoothService.sendMessage({
      type: 'NEXT_ROUND',
      data: { letter: newLetter },
    });

    // Attendre un peu que l'adversaire reçoive le message
    setTimeout(() => {
      startNextRound(newLetter);
    }, 500);
  };

  // Gérer l'arrêt de la partie
  const handleStopGame = async () => {
    Alert.alert(
      'Arrêter la partie',
      'Voulez-vous vraiment arrêter la partie ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Arrêter',
          style: 'destructive',
          onPress: async () => {
            await bluetoothService.sendMessage({
              type: 'FINISH_GAME',
              data: {},
            });
            setShowFinalResults(true);
          },
        },
      ]
    );
  };

  // Nouvelle partie
  const handleNewGame = () => {
    bluetoothService.disconnect();
    resetGame();
    router.replace('/');
  };

  if (!results) {
    router.replace('/');
    return null;
  }

  // Scores totaux
  const myTotalScore = totalScore + myFinalScore;
  const opponentTotal = opponentTotalScore + opponentFinalScore;

  // Affichage des résultats finaux
  if (showFinalResults) {
    const isWinner = myTotalScore > opponentTotal;
    const isDraw = myTotalScore === opponentTotal;

    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.winnerSection}>
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
          </View>

          <View style={styles.finalScoresCard}>
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
                  <Text style={styles.validCount}>
                    {roundHistory.reduce((sum, r) => sum + r.myValidWords, 0)} mots valides
                  </Text>
                </View>
              </View>

              <View style={[styles.finalScoreBlock, !isWinner && !isDraw && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>{opponentName}</Text>
                <Text style={styles.finalScoreValue}>{opponentTotal}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color="#FFD700" />
                  <Text style={styles.validCount}>
                    {roundHistory.reduce((sum, r) => sum + r.opponentValidWords, 0)} mots valides
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.historyContainer}>
            <Text style={styles.sectionTitle}>Historique ({roundHistory.length} manches)</Text>
            {roundHistory.map((round, index) => (
              <View key={index} style={styles.historyCard}>
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
              </View>
            ))}
          </View>

          <View style={styles.buttonContainer}>
            <Button title="Nouvelle partie" onPress={handleNewGame} />
          </View>
        </ScrollView>
      </View>
    );
  }

  // Écran d'attente pour la manche suivante
  if (waitingForNextRound) {
    return (
      <View style={styles.container}>
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingTitle}>En attente de l'hôte...</Text>
          <Text style={styles.waitingText}>
            {opponentName} prépare la prochaine manche
          </Text>
        </View>
      </View>
    );
  }

  // Affichage des résultats de la manche
  const isWinner = myFinalScore > opponentFinalScore;
  const isDraw = myFinalScore === opponentFinalScore;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.roundHeader}>
          <Text style={styles.roundTitle}>Manche {currentRound}</Text>
          <View style={styles.letterBadge}>
            <Text style={styles.letterText}>{currentLetter}</Text>
          </View>
        </View>

        <View style={styles.scoreCard}>
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
                <Text style={styles.validCount}>{results.filter(r => r.isValid).length} valides</Text>
              </View>
              {stoppedEarly && results.some(r => r.word && !r.isValid) && (
                <Text style={styles.penaltyText}>⚠️ -3pts (pénalité)</Text>
              )}
            </View>

            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>{opponentName}</Text>
              <Text style={styles.scoreValue}>
                {loading ? '...' : opponentFinalScore}
              </Text>
              {!loading && (
                <>
                  <View style={styles.statsRow}>
                    <CheckCircle size={16} color="#4caf50" />
                    <Text style={styles.validCount}>
                      {opponentResults.filter(r => r.isValid).length} valides
                    </Text>
                  </View>
                  {opponentStoppedEarly && opponentResults.some(r => r.word && !r.isValid) && (
                    <Text style={styles.penaltyText}>⚠️ -3pts (pénalité)</Text>
                  )}
                </>
              )}
            </View>
          </View>
        </View>

        <View style={styles.totalScoreCard}>
          <Text style={styles.totalScoreLabel}>Score total</Text>
          <View style={styles.totalScoreRow}>
            <Text style={styles.totalScoreValue}>{myTotalScore}</Text>
            <Text style={styles.totalScoreSeparator}>-</Text>
            <Text style={styles.totalScoreValue}>{opponentTotal}</Text>
          </View>
        </View>

        {!loading && opponentResults.length > 0 && (
          <View style={styles.comparisonContainer}>
            <Text style={styles.sectionTitle}>Réponses</Text>
            {results.map((result, index) => {
              const opponentResult = opponentResults[index];
              return (
                <View key={index} style={styles.comparisonCard}>
                  <Text style={styles.categoryName}>{result.categorieName}</Text>
                  <View style={styles.comparisonRow}>
                    <View style={styles.answerBlock}>
                      {result.word ? (
                        <View style={styles.answerContainer}>
                          <Text style={styles.answerWord}>{result.word}</Text>
                          {result.isValid ? (
                            <CheckCircle size={20} color="#4caf50" />
                          ) : (
                            <XCircle size={20} color="#f44336" />
                          )}
                          <Text style={styles.pointsText}>+{result.points}</Text>
                        </View>
                      ) : (
                        <Text style={styles.noAnswer}>-</Text>
                      )}
                    </View>

                    <View style={styles.answerBlock}>
                      {opponentResult?.word ? (
                        <View style={styles.answerContainer}>
                          <Text style={styles.answerWord}>{opponentResult.word}</Text>
                          {opponentResult.isValid ? (
                            <CheckCircle size={20} color="#4caf50" />
                          ) : (
                            <XCircle size={20} color="#f44336" />
                          )}
                          <Text style={styles.pointsText}>+{opponentResult.points}</Text>
                        </View>
                      ) : (
                        <Text style={styles.noAnswer}>-</Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.buttonContainer}>
          <Button
            title="Manche suivante"
            onPress={handleNextRound}
            icon={<Play size={20} color="#fff" />}
          />
          <Button
            title="Arrêter la partie"
            onPress={handleStopGame}
            variant="secondary"
            icon={<StopCircle size={20} color="#007AFF" />}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e27',
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: SAFE_AREA_HEIGHT,
  },
  roundHeader: {
    alignItems: 'center',
    marginBottom: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  roundTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
  },
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
  letterText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFD700',
  },
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
  scoreLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  scoresRow: {
    flexDirection: 'row',
    gap: 16,
  },
  scoreBlock: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
  },
  playerLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
  },
  scoreValue: {
    fontSize: 48,
    fontWeight: '800',
    color: '#007AFF',
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  validCount: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
  },
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
  totalScoreLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
  },
  totalScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  totalScoreValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#007AFF',
  },
  totalScoreSeparator: {
    fontSize: 24,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  comparisonContainer: {
    marginBottom: 24,
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
  comparisonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  answerBlock: {
    flex: 1,
  },
  answerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: 8,
    borderRadius: 8,
  },
  answerWord: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '600',
    flex: 1,
  },
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
  buttonContainer: {
    gap: 12,
    marginTop: 8,
  },
  winnerSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  winnerText: {
    fontSize: 36,
    fontWeight: '800',
    color: '#4caf50',
    marginTop: 20,
  },
  loserText: {
    fontSize: 32,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 16,
  },
  winnerName: {
    fontSize: 20,
    color: '#007AFF',
    marginTop: 8,
  },
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
  finalScoresRow: {
    flexDirection: 'row',
    gap: 16,
  },
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
  finalScoreValue: {
    fontSize: 52,
    fontWeight: '800',
    color: '#007AFF',
    marginBottom: 8,
  },
  historyContainer: {
    marginBottom: 24,
  },
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
  historyRound: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  historyScores: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  historyScore: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  waitingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
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