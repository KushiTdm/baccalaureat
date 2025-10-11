// app/online-results.tsx
import { View, Text, StyleSheet, ScrollView, Alert, Modal, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import Button from '../components/Button';
import { onlineService, GameRoomPlayer, GameRoomAnswer, GameRoundScore } from '../services/online';
import { CheckCircle, XCircle, Trophy, Crown, AlertCircle, Play, StopCircle } from 'lucide-react-native';
import { GameResult, RoundHistory } from '../store/gameStore';
import { getCategories } from '../services/api';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function OnlineResultsScreen() {
  const router = useRouter();
  const { 
    results, 
    score, 
    resetGame, 
    categories,
    currentRound,
    totalScore,
    opponentTotalScore,
    roundHistory,
    addRoundToHistory,
    updateTotalScores,
    startNewRound,
    currentLetter,
    startMultiplayerGame,
    opponentName,
    isHost,
  } = useGameStore();

  const [allPlayers, setAllPlayers] = useState<GameRoomPlayer[]>([]);
  const [allAnswers, setAllAnswers] = useState<GameRoomAnswer[]>([]);
  const [roundScores, setRoundScores] = useState<GameRoundScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [contestedWord, setContestedWord] = useState<GameRoomAnswer | null>(null);
  const [myVote, setMyVote] = useState<boolean | null>(null);
  const [opponentVote, setOpponentVote] = useState<boolean | null>(null);
  const [showFinalResults, setShowFinalResults] = useState(false);

  const roomId = onlineService.getCurrentRoomId();
  const currentPlayerId = onlineService.getCurrentPlayerId();
  const roundId = onlineService.getCurrentRoundId();

  useEffect(() => {
    if (!roomId || !results || !roundId) {
      router.replace('/');
      return;
    }

    loadResults();
  }, [roomId, roundId]);

  async function loadResults() {
    if (!roomId || !roundId) return;

    try {
      const [players, answers, scores] = await Promise.all([
        onlineService.getPlayers(roomId),
        onlineService.getRoundAnswers(roundId),
        onlineService.getRoundScores(roundId),
      ]);

      setAllPlayers(players);
      setAllAnswers(answers);
      setRoundScores(scores);
    } catch (error) {
      console.error('Error loading results:', error);
    } finally {
      setLoading(false);
    }
  }

  if (!results || !roomId || !currentPlayerId || !roundId) {
    router.replace('/');
    return null;
  }

  const opponent = allPlayers.find(p => p.id !== currentPlayerId);
  const myRoundScore = roundScores.find(s => s.player_id === currentPlayerId);
  const opponentRoundScore = roundScores.find(s => s.player_id !== currentPlayerId);

  // Calculer les scores réels depuis les réponses
  const myAnswers = allAnswers.filter(a => a.player_id === currentPlayerId);
  const opponentAnswers = allAnswers.filter(a => a.player_id !== currentPlayerId);
  
  const myCalculatedScore = myAnswers.reduce((sum, a) => sum + a.points, 0);
  const opponentCalculatedScore = opponentAnswers.reduce((sum, a) => sum + a.points, 0);

  // Appliquer les pénalités
  const myFinalScore = myRoundScore?.penalty_applied 
    ? Math.max(0, myCalculatedScore - 3) 
    : myCalculatedScore;
  const opponentFinalScore = opponentRoundScore?.penalty_applied 
    ? Math.max(0, opponentCalculatedScore - 3) 
    : opponentCalculatedScore;

  async function handleContestWord(answer: GameRoomAnswer) {
    setContestedWord(answer);
    setMyVote(null);
    setOpponentVote(null);

    // Vérifier si des votes existent déjà
    const existingVotes = await onlineService.getWordValidationVotes(answer.id);
    
    if (existingVotes.length === 0) {
      // Créer les votes
      await onlineService.createWordValidationVote(
        roomId,
        roundId,
        answer.id,
        answer.word,
        answer.categorie_id,
        allPlayers
      );
    } else {
      // Charger les votes existants
      const myExistingVote = existingVotes.find(v => v.player_id === currentPlayerId);
      const opponentExistingVote = existingVotes.find(v => v.player_id !== currentPlayerId);
      
      if (myExistingVote) setMyVote(myExistingVote.vote);
      if (opponentExistingVote) setOpponentVote(opponentExistingVote.vote);
    }

    setShowValidationModal(true);
  }

  async function handleVote(isValid: boolean) {
    if (!contestedWord) return;

    setMyVote(isValid);

    try {
      const votes = await onlineService.getWordValidationVotes(contestedWord.id);
      const myVoteRecord = votes.find(v => v.player_id === currentPlayerId);
      
      if (myVoteRecord) {
        await onlineService.voteForWordValidation(myVoteRecord.id, currentPlayerId, isValid);
      }

      // Polling pour attendre le vote de l'adversaire
      Alert.alert('Vote enregistré', 'En attente du vote de votre adversaire...');

      const checkVotes = setInterval(async () => {
        const updatedVotes = await onlineService.getWordValidationVotes(contestedWord.id);
        const allVoted = updatedVotes.every(v => v.vote !== null);

        if (allVoted) {
          clearInterval(checkVotes);

          // Calculer le résultat (unanimité requise)
          const allValid = updatedVotes.every(v => v.vote === true);
          const points = allValid ? 2 : 0;

          // Mettre à jour la réponse
          await onlineService.updateAnswerWithManualValidation(contestedWord.id, allValid, points);

          setShowValidationModal(false);
          
          Alert.alert(
            'Validation terminée',
            allValid ? 'Le mot a été validé' : 'Le mot a été refusé',
            [{ text: 'OK', onPress: () => loadResults() }]
          );
        }
      }, 1000);

      // Timeout après 60 secondes
      setTimeout(() => {
        clearInterval(checkVotes);
      }, 60000);

    } catch (error) {
      Alert.alert('Erreur', 'Impossible d\'enregistrer le vote');
    }
  }

  async function handleNextRound() {
    if (!roomId || !opponent) return;

    try {
      // Ajouter la manche à l'historique avec les scores corrigés
      const roundData: RoundHistory = {
        roundNumber: currentRound,
        letter: currentLetter || '',
        myScore: myFinalScore,
        opponentScore: opponentFinalScore,
        myValidWords: myAnswers.filter(a => a.is_valid).length,
        opponentValidWords: opponentAnswers.filter(a => a.is_valid).length,
      };
      addRoundToHistory(roundData);
      updateTotalScores(myFinalScore, opponentFinalScore);

      // Nouvelle lettre aléatoire
      const newLetter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      
      // Créer la nouvelle manche
      const newRound = await onlineService.createRound(roomId, currentRound + 1, newLetter);
      onlineService.setCurrentRoundId(newRound.id);

      // Démarrer la nouvelle manche dans le store
      startNewRound(newLetter);

      // Recharger les catégories et retourner au jeu
      const cats = await getCategories();
      startMultiplayerGame(newLetter, cats, isHost, opponent.player_name);

      router.replace('/online-game');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de démarrer la manche suivante');
    }
  }

  async function handleStopGame() {
    Alert.alert(
      'Arrêter la partie',
      'Voulez-vous vraiment arrêter la partie ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Arrêter',
          style: 'destructive',
          onPress: async () => {
            // Ajouter la dernière manche à l'historique
            const roundData: RoundHistory = {
              roundNumber: currentRound,
              letter: currentLetter || '',
              myScore: myFinalScore,
              opponentScore: opponentFinalScore,
              myValidWords: myAnswers.filter(a => a.is_valid).length,
              opponentValidWords: opponentAnswers.filter(a => a.is_valid).length,
            };
            addRoundToHistory(roundData);
            updateTotalScores(myFinalScore, opponentFinalScore);

            // Terminer la partie
            if (roomId) {
              await onlineService.finishGame(roomId);
            }

            setShowFinalResults(true);
          },
        },
      ]
    );
  }

  function handleNewGame() {
    onlineService.clearCurrentRoom();
    resetGame();
    router.replace('/');
  }

  const myTotalScore = totalScore + myFinalScore;
  const opponentTotal = opponentTotalScore + opponentFinalScore;

  // Résultats finaux
  if (showFinalResults) {
    const isWinner = myTotalScore > opponentTotal;
    const isDraw = myTotalScore === opponentTotal;
    const totalMyValidWords = roundHistory.reduce((sum, r) => sum + r.myValidWords, 0) + 
                               myAnswers.filter(a => a.is_valid).length;
    const totalOpponentValidWords = roundHistory.reduce((sum, r) => sum + r.opponentValidWords, 0) + 
                                     opponentAnswers.filter(a => a.is_valid).length;

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.winnerSection}>
            {isDraw ? (
              <>
                <Trophy size={64} color="#FFD700" />
                <Text style={styles.winnerText}>Égalité ! 🤝</Text>
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
                <Text style={styles.winnerName}>{opponent?.player_name} gagne !</Text>
              </>
            )}
          </View>

          <View style={styles.finalScoresCard}>
            <Text style={styles.sectionTitle}>Score final</Text>
            <View style={styles.finalScoresRow}>
              <View style={[styles.finalScoreBlock, isWinner && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>Vous</Text>
                <Text style={styles.finalScoreValue}>{myTotalScore}</Text>
                <Text style={styles.validCount}>{totalMyValidWords} mots valides</Text>
              </View>
              <View style={[styles.finalScoreBlock, !isWinner && !isDraw && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>{opponent?.player_name}</Text>
                <Text style={styles.finalScoreValue}>{opponentTotal}</Text>
                <Text style={styles.validCount}>{totalOpponentValidWords} mots valides</Text>
              </View>
            </View>
          </View>

          <View style={styles.historyContainer}>
            <Text style={styles.sectionTitle}>Historique des manches ({roundHistory.length + 1})</Text>
            {roundHistory.map((round, index) => (
              <View key={index} style={styles.historyCard}>
                <Text style={styles.historyRound}>Manche {round.roundNumber} - Lettre {round.letter}</Text>
                <View style={styles.historyScores}>
                  <Text style={styles.historyScore}>Vous: {round.myScore} pts</Text>
                  <Text style={styles.historyScore}>{opponent?.player_name}: {round.opponentScore} pts</Text>
                </View>
              </View>
            ))}
            <View style={styles.historyCard}>
              <Text style={styles.historyRound}>Manche {currentRound} - Lettre {currentLetter}</Text>
              <View style={styles.historyScores}>
                <Text style={styles.historyScore}>Vous: {myFinalScore} pts</Text>
                <Text style={styles.historyScore}>{opponent?.player_name}: {opponentFinalScore} pts</Text>
              </View>
            </View>
          </View>

          <View style={styles.buttonContainer}>
            <Button title="Nouvelle partie" onPress={handleNewGame} />
          </View>
        </ScrollView>
      </View>
    );
  }

  // Résultats de manche avec comparaison détaillée
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.roundHeader}>
          <Text style={styles.roundTitle}>Manche {currentRound} terminée</Text>
          <Text style={styles.letterText}>Lettre: {currentLetter}</Text>
        </View>

        <View style={styles.roundScoresCard}>
          <Text style={styles.sectionTitle}>Score de la manche</Text>
          <View style={styles.scoresRow}>
            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>Vous</Text>
              <Text style={styles.scoreValue}>{myFinalScore}</Text>
              <Text style={styles.validCount}>{myAnswers.filter(a => a.is_valid).length} valides</Text>
              {myRoundScore?.penalty_applied && (
                <Text style={styles.penaltyText}>⚠️ Pénalité -3</Text>
              )}
            </View>
            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>{opponent?.player_name}</Text>
              <Text style={styles.scoreValue}>{opponentFinalScore}</Text>
              <Text style={styles.validCount}>{opponentAnswers.filter(a => a.is_valid).length} valides</Text>
              {opponentRoundScore?.penalty_applied && (
                <Text style={styles.penaltyText}>⚠️ Pénalité -3</Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.totalScoresCard}>
          <Text style={styles.sectionTitle}>Score total</Text>
          <View style={styles.scoresRow}>
            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>Vous</Text>
              <Text style={styles.totalScoreValue}>{myTotalScore}</Text>
            </View>
            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>{opponent?.player_name}</Text>
              <Text style={styles.totalScoreValue}>{opponentTotal}</Text>
            </View>
          </View>
        </View>

        {/* Comparaison détaillée */}
        <View style={styles.comparisonContainer}>
          <Text style={styles.sectionTitle}>Comparaison des réponses</Text>
          {categories.map((category) => {
            const myAnswer = myAnswers.find(a => a.categorie_id === category.id);
            const oppAnswer = opponentAnswers.find(a => a.categorie_id === category.id);

            return (
              <View key={category.id} style={styles.comparisonCard}>
                <Text style={styles.categoryName}>{category.nom}</Text>
                <View style={styles.comparisonRow}>
                  <View style={styles.answerBlock}>
                    <Text style={styles.answerLabel}>Vous</Text>
                    {myAnswer?.word ? (
                      <View style={styles.answerContainer}>
                        <Text style={styles.answerWord}>{myAnswer.word}</Text>
                        {myAnswer.is_valid ? (
                          <CheckCircle size={20} color="#4caf50" />
                        ) : (
                          <>
                            <XCircle size={20} color="#f44336" />
                            <TouchableOpacity onPress={() => handleContestWord(myAnswer)}>
                              <AlertCircle size={20} color="#FF9800" />
                            </TouchableOpacity>
                          </>
                        )}
                        <Text style={styles.pointsText}>+{myAnswer.points}</Text>
                      </View>
                    ) : (
                      <Text style={styles.noAnswer}>-</Text>
                    )}
                  </View>

                  <View style={styles.answerBlock}>
                    <Text style={styles.answerLabel}>{opponent?.player_name}</Text>
                    {oppAnswer?.word ? (
                      <View style={styles.answerContainer}>
                        <Text style={styles.answerWord}>{oppAnswer.word}</Text>
                        {oppAnswer.is_valid ? (
                          <CheckCircle size={20} color="#4caf50" />
                        ) : (
                          <>
                            <XCircle size={20} color="#f44336" />
                            <TouchableOpacity onPress={() => handleContestWord(oppAnswer)}>
                              <AlertCircle size={20} color="#FF9800" />
                            </TouchableOpacity>
                          </>
                        )}
                        <Text style={styles.pointsText}>+{oppAnswer.points}</Text>
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

        <View style={styles.infoBox}>
          <AlertCircle size={20} color="#FF9800" />
          <Text style={styles.infoText}>
            Cliquez sur l'icône orange pour contester un mot
          </Text>
        </View>

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

      {/* Modal de validation manuelle */}
      <Modal visible={showValidationModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <AlertCircle size={48} color="#FF9800" />
            <Text style={styles.modalTitle}>Contester le mot</Text>
            {contestedWord && (
              <>
                <Text style={styles.modalText}>
                  Le mot "<Text style={styles.modalWord}>{contestedWord.word}</Text>"
                </Text>
                <Text style={styles.modalCategory}>
                  Catégorie: {categories.find(c => c.id === contestedWord.categorie_id)?.nom}
                </Text>
                <Text style={styles.modalQuestion}>Ce mot est-il valide ?</Text>
                <Text style={styles.modalInfo}>
                  Les deux joueurs doivent accepter pour valider
                </Text>

                {myVote !== null && (
                  <Text style={styles.voteStatus}>
                    Votre vote: {myVote ? '✓ Valide' : '✗ Invalide'}
                  </Text>
                )}

                <View style={styles.modalButtons}>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.rejectButton, myVote === false && styles.selectedButton]}
                    onPress={() => handleVote(false)}
                    disabled={myVote !== null}
                  >
                    <XCircle size={24} color="#fff" />
                    <Text style={styles.modalButtonText}>Invalide</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.acceptButton, myVote === true && styles.selectedButton]}
                    onPress={() => handleVote(true)}
                    disabled={myVote !== null}
                  >
                    <CheckCircle size={24} color="#fff" />
                    <Text style={styles.modalButtonText}>Valide</Text>
                  </TouchableOpacity>
                </View>

                <Button
                  title="Annuler"
                  onPress={() => setShowValidationModal(false)}
                  variant="secondary"
                />
              </>
            )}
          </View>
        </View>
      </Modal>
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
  roundHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  roundTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  letterText: {
    fontSize: 18,
    color: '#666',
  },
  roundScoresCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  totalScoresCard: {
    backgroundColor: '#e3f2fd',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  scoresRow: {
    flexDirection: 'row',
    gap: 12,
  },
  scoreBlock: {
    flex: 1,
    alignItems: 'center',
  },
  playerLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  scoreValue: {
    fontSize: 36,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 4,
  },
  totalScoreValue: {
    fontSize: 42,
    fontWeight: '700',
    color: '#1976d2',
  },
  validCount: {
    fontSize: 14,
    color: '#666',
  },
  penaltyText: {
    fontSize: 12,
    color: '#f44336',
    marginTop: 4,
    fontWeight: '600',
  },
  comparisonContainer: {
    marginBottom: 24,
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
    flexWrap: 'wrap',
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
  pointsText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4caf50',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: '#fff3cd',
    borderRadius: 12,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#856404',
  },
  buttonContainer: {
    gap: 12,
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
  finalScoresCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  finalScoresRow: {
    flexDirection: 'row',
    gap: 12,
  },
  finalScoreBlock: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
  },
  winnerBlock: {
    backgroundColor: '#e8f5e9',
    borderWidth: 2,
    borderColor: '#4caf50',
  },
  finalScoreValue: {
    fontSize: 48,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 4,
  },
  historyContainer: {
    marginBottom: 24,
  },
  historyCard: {
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
  historyRound: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  historyScores: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyScore: {
    fontSize: 14,
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    gap: 12,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  modalText: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
  },
  modalWord: {
    fontWeight: '700',
    color: '#007AFF',
  },
  modalCategory: {
    fontSize: 14,
    color: '#666',
  },
  modalQuestion: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  modalInfo: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
  voteStatus: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4caf50',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
  },
  acceptButton: {
    backgroundColor: '#4caf50',
  },
  rejectButton: {
    backgroundColor: '#f44336',
  },
  selectedButton: {
    opacity: 0.6,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});