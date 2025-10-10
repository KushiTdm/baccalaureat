// app/online-results.tsx
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import Button from '../components/Button';
import { onlineService, GameRoomPlayer, GameRoomAnswer } from '../services/online';
import { CheckCircle, XCircle, Trophy, Crown } from 'lucide-react-native';
import { GameResult } from '../store/gameStore';

export default function OnlineResultsScreen() {
  const router = useRouter();
  const { results, score, resetGame, categories } = useGameStore();
  const [allPlayers, setAllPlayers] = useState<GameRoomPlayer[]>([]);
  const [allAnswers, setAllAnswers] = useState<GameRoomAnswer[]>([]);
  const [loading, setLoading] = useState(true);

  const roomId = onlineService.getCurrentRoomId();
  const currentPlayerId = onlineService.getCurrentPlayerId();

  useEffect(() => {
    if (!roomId || !results) {
      router.replace('/');
      return;
    }

    loadResults();

    // Subscribe to real-time updates
    onlineService.subscribeToRoom(roomId, {
      onPlayerJoined: () => {},
      onPlayerLeft: () => {},
      onGameStarted: () => {},
      onPlayerFinished: (player) => {
        setAllPlayers(prev => {
          const index = prev.findIndex(p => p.id === player.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = player;
            return updated;
          }
          return [...prev, player];
        });
      },
      onAnswerSubmitted: (answer) => {
        setAllAnswers(prev => [...prev, answer]);
      },
    });

    return () => {
      onlineService.unsubscribeFromRoom();
    };
  }, [roomId]);

  async function loadResults() {
    if (!roomId) return;

    try {
      const [players, answers] = await Promise.all([
        onlineService.getPlayers(roomId),
        onlineService.getRoomAnswers(roomId),
      ]);

      setAllPlayers(players);
      setAllAnswers(answers);
    } catch (error) {
      console.error('Error loading results:', error);
    } finally {
      setLoading(false);
    }
  }

  if (!results || !roomId || !currentPlayerId) {
    router.replace('/');
    return null;
  }

  // Calculate rankings
  const rankedPlayers = [...allPlayers]
    .filter(p => p.finished_at !== null)
    .sort((a, b) => b.score - a.score);

  const currentPlayer = allPlayers.find(p => p.id === currentPlayerId);
  const currentRank = rankedPlayers.findIndex(p => p.id === currentPlayerId) + 1;
  const isWinner = currentRank === 1 && rankedPlayers.length > 1;
  
  // Get opponent results (for 1v1 comparison)
  const opponent = allPlayers.find(p => p.id !== currentPlayerId);
  const opponentAnswers = opponent 
    ? allAnswers.filter(a => a.player_id === opponent.id)
    : [];

  function getOpponentResultForCategory(categorieId: number): GameRoomAnswer | undefined {
    return opponentAnswers.find(a => a.categorie_id === categorieId);
  }

  function handlePlayAgain() {
    onlineService.clearCurrentRoom();
    resetGame();
    router.replace('/');
  }

  const myValidAnswers = results.filter((r) => r.isValid).length;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Winner announcement */}
        <View style={styles.winnerSection}>
          {isWinner ? (
            <>
              <Crown size={64} color="#FFD700" />
              <Text style={styles.winnerText}>Victoire ! 🎉</Text>
              <Text style={styles.rankText}>1er sur {rankedPlayers.length}</Text>
            </>
          ) : currentRank > 0 ? (
            <>
              <Trophy size={64} color="#999" />
              <Text style={styles.rankText}>{currentRank}ème sur {rankedPlayers.length}</Text>
            </>
          ) : (
            <>
              <Trophy size={64} color="#999" />
              <Text style={styles.loserText}>En attente...</Text>
            </>
          )}
        </View>

        {/* Rankings */}
        {rankedPlayers.length > 0 && (
          <View style={styles.rankingsContainer}>
            <Text style={styles.sectionTitle}>Classement</Text>
            {rankedPlayers.map((player, index) => {
              const isCurrentPlayer = player.id === currentPlayerId;
              const validAnswersCount = allAnswers
                .filter(a => a.player_id === player.id && a.is_valid)
                .length;

              return (
                <View 
                  key={player.id} 
                  style={[
                    styles.rankCard,
                    isCurrentPlayer && styles.currentPlayerCard
                  ]}
                >
                  <View style={styles.rankNumber}>
                    <Text style={styles.rankNumberText}>{index + 1}</Text>
                  </View>
                  <View style={styles.rankInfo}>
                    <Text style={styles.playerName}>
                      {player.player_name}
                      {isCurrentPlayer && ' (Vous)'}
                    </Text>
                    <Text style={styles.validCount}>
                      {validAnswersCount} réponses valides
                    </Text>
                  </View>
                  <Text style={styles.playerScore}>{player.score}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Detailed comparison (1v1 mode) */}
        {!loading && opponent && opponentAnswers.length > 0 && (
          <View style={styles.comparisonContainer}>
            <Text style={styles.comparisonTitle}>Comparaison détaillée</Text>
            {results.map((result, index) => {
              const opponentAnswer = getOpponentResultForCategory(result.categorieId);
              
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
                      <Text style={styles.answerLabel}>{opponent.player_name}</Text>
                      {opponentAnswer?.word ? (
                        <View style={styles.answerContainer}>
                          <Text style={styles.answerWord}>{opponentAnswer.word}</Text>
                          {opponentAnswer.is_valid ? (
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

        {/* My answers (multiplayer mode with 3+ players) */}
        {allPlayers.length > 2 && (
          <View style={styles.myAnswersContainer}>
            <Text style={styles.sectionTitle}>Mes réponses</Text>
            {results.map((result, index) => (
              <View key={index} style={styles.answerCard}>
                <Text style={styles.categoryName}>{result.categorieName}</Text>
                {result.word ? (
                  <View style={styles.answerContainer}>
                    <Text style={styles.answerWord}>{result.word}</Text>
                    {result.isValid ? (
                      <>
                        <CheckCircle size={20} color="#4caf50" />
                        <Text style={styles.points}>+{result.points}</Text>
                      </>
                    ) : (
                      <XCircle size={20} color="#f44336" />
                    )}
                  </View>
                ) : (
                  <Text style={styles.noAnswer}>Pas de réponse</Text>
                )}
              </View>
            ))}
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
  rankText: {
    fontSize: 20,
    color: '#666',
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  rankingsContainer: {
    marginBottom: 32,
  },
  rankCard: {
    flexDirection: 'row',
    alignItems: 'center',
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
  currentPlayerCard: {
    backgroundColor: '#e3f2fd',
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  rankNumber: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankNumberText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  rankInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  validCount: {
    fontSize: 14,
    color: '#666',
  },
  playerScore: {
    fontSize: 24,
    fontWeight: '700',
    color: '#007AFF',
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
  myAnswersContainer: {
    marginBottom: 32,
  },
  answerCard: {
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
  points: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4caf50',
  },
  buttonContainer: {
    marginTop: 8,
  },
});