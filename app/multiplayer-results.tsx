// app/multiplayer-results.tsx
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import Button from '../components/Button';
import { bluetoothService, GameMessage } from '../services/bluetooth';
import { CheckCircle, XCircle, Trophy, Crown } from 'lucide-react-native';
import { GameResult } from '../store/gameStore';

export default function MultiplayerResultsScreen() {
  const router = useRouter();
  const { results, score, resetGame, opponentName } = useGameStore();
  const [opponentResults, setOpponentResults] = useState<GameResult[]>([]);
  const [opponentScore, setOpponentScore] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen for opponent results
    bluetoothService.setMessageListener(handleOpponentMessage);

    // If we already received results, stop loading
    const timer = setTimeout(() => {
      setLoading(false);
    }, 5000);

    return () => {
      clearTimeout(timer);
      bluetoothService.disconnect();
    };
  }, []);

  if (!results) {
    router.replace('/');
    return null;
  }

  function handleOpponentMessage(message: GameMessage) {
    if (message.type === 'ANSWER_SUBMIT') {
      setOpponentResults(message.data.results);
      setOpponentScore(message.data.score);
      setLoading(false);
    }
  }

  function handlePlayAgain() {
    resetGame();
    router.replace('/');
  }

  const myValidAnswers = results.filter((r) => r.isValid).length;
  const opponentValidAnswers = opponentResults.filter((r) => r.isValid).length;
  const isWinner = score > opponentScore;
  const isDraw = score === opponentScore;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Winner announcement */}
        <View style={styles.winnerSection}>
          {isDraw ? (
            <>
              <Trophy size={64} color="#FFD700" />
              <Text style={styles.winnerText}>Égalité !</Text>
            </>
          ) : isWinner ? (
            <>
              <Crown size={64} color="#FFD700" />
              <Text style={styles.winnerText}>Victoire ! 🎉</Text>
            </>
          ) : (
            <>
              <Trophy size={64} color="#999" />
              <Text style={styles.loserText}>Défaite</Text>
              <Text style={styles.winnerName}>{opponentName} gagne !</Text>
            </>
          )}
        </View>

        {/* Scores comparison */}
        <View style={styles.scoresContainer}>
          <View style={[styles.scoreCard, isWinner && styles.winnerCard]}>
            <Text style={styles.playerLabel}>Vous</Text>
            <Text style={styles.scoreValue}>{score}</Text>
            <Text style={styles.validCount}>
              {myValidAnswers} valides
            </Text>
          </View>

          <View style={[styles.scoreCard, !isWinner && !isDraw && styles.winnerCard]}>
            <Text style={styles.playerLabel}>{opponentName}</Text>
            <Text style={styles.scoreValue}>
              {loading ? '...' : opponentScore}
            </Text>
            <Text style={styles.validCount}>
              {loading ? '...' : `${opponentValidAnswers} valides`}
            </Text>
          </View>
        </View>

        {/* Detailed comparison */}
        {!loading && opponentResults.length > 0 && (
          <View style={styles.comparisonContainer}>
            <Text style={styles.comparisonTitle}>Comparaison détaillée</Text>
            {results.map((result, index) => {
              const opponentResult = opponentResults[index];
              return (
                <View key={index} style={styles.comparisonCard}>
                  <Text style={styles.categoryName}>{result.categorieName}</Text>
                  
                  <View style={styles.comparisonRow}>
                    <View style={styles.answerBlock}>
                      <Text style={styles.answerLabel}>Vous</Text>
                      {result.word ? (
                        <View style={styles.answerContainer}>
                          <Text style={styles.answerWord}>{result.word}</Text>
                          {result.isValid ? (
                            <CheckCircle size={20} color="#4caf50" />
                          ) : (
                            <XCircle size={20} color="#f44336" />
                          )}
                        </View>
                      ) : (
                        <Text style={styles.noAnswer}>-</Text>
                      )}
                    </View>

                    <View style={styles.answerBlock}>
                      <Text style={styles.answerLabel}>{opponentName}</Text>
                      {opponentResult?.word ? (
                        <View style={styles.answerContainer}>
                          <Text style={styles.answerWord}>{opponentResult.word}</Text>
                          {opponentResult.isValid ? (
                            <CheckCircle size={20} color="#4caf50" />
                          ) : (
                            <XCircle size={20} color="#f44336" />
                          )}
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
          <Button title="Nouvelle partie" onPress={handlePlayAgain} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  winnerSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  winnerText: {
    fontSize: 36,
    fontWeight: '700',
    color: '#4caf50',
    marginTop: 16,
  },
  loserText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#666',
    marginTop: 16,
  },
  winnerName: {
    fontSize: 20,
    color: '#007AFF',
    marginTop: 8,
  },
  scoresContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  scoreCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  winnerCard: {
    backgroundColor: '#e8f5e9',
    borderWidth: 2,
    borderColor: '#4caf50',
  },
  playerLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  scoreValue: {
    fontSize: 48,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 4,
  },
  validCount: {
    fontSize: 14,
    color: '#666',
  },
  comparisonContainer: {
    marginBottom: 32,
  },
  comparisonTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  comparisonCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
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
  answerLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  answerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  answerWord: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
    flex: 1,
  },
  noAnswer: {
    fontSize: 16,
    color: '#ccc',
    fontStyle: 'italic',
  },
  buttonContainer: {
    marginTop: 8,
  },
});