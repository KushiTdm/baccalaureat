// app/online-results.tsx
import { View, Text, StyleSheet, ScrollView, Alert, Modal, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import Button from '../components/Button';
import { onlineService, GameRoomPlayer, GameRoomAnswer, GameRoundScore, WordValidationVote } from '../services/online';
import { CheckCircle, XCircle, Trophy, Crown, HelpCircle, Play, StopCircle } from 'lucide-react-native';
import { GameResult, RoundHistory } from '../store/gameStore';
import { getCategories } from '../services/api';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

type WordNeedingValidation = {
  answerId: string;
  word: string;
  categorieId: number;
  categoryName: string;
  playerId: string;
  playerName: string;
};

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
    stoppedEarly,
    currentLetter,
    startMultiplayerGame,
    opponentName,
    isHost,
  } = useGameStore();

  const [allPlayers, setAllPlayers] = useState<GameRoomPlayer[]>([]);
  const [allAnswers, setAllAnswers] = useState<GameRoomAnswer[]>([]);
  const [roundScores, setRoundScores] = useState<GameRoundScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [wordsNeedingValidation, setWordsNeedingValidation] = useState<WordNeedingValidation[]>([]);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [currentValidationIndex, setCurrentValidationIndex] = useState(0);
  const [validationVotes, setValidationVotes] = useState<Record<string, boolean>>({});
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

      // Identifier les mots nécessitant une validation manuelle
      const needsValidation: WordNeedingValidation[] = [];
      for (const answer of answers) {
        if (answer.needs_manual_validation && answer.manual_validation_result === null) {
          const player = players.find(p => p.id === answer.player_id);
          const category = categories.find(c => c.id === answer.categorie_id);
          if (player && category) {
            needsValidation.push({
              answerId: answer.id,
              word: answer.word,
              categorieId: answer.categorie_id,
              categoryName: category.nom,
              playerId: answer.player_id,
              playerName: player.player_name,
            });
          }
        }
      }

      setWordsNeedingValidation(needsValidation);

      // Si des mots nécessitent validation, afficher le modal
      if (needsValidation.length > 0) {
        // Créer les votes si pas déjà créés
        for (const word of needsValidation) {
          const existingVotes = await onlineService.getWordValidationVotes(word.answerId);
          if (existingVotes.length === 0) {
            await onlineService.createWordValidationVote(
              roomId,
              roundId,
              word.answerId,
              word.word,
              word.categorieId,
              players
            );
          }
        }
        setShowValidationModal(true);
      }
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

  async function handleValidateWord(isValid: boolean) {
    if (currentValidationIndex >= wordsNeedingValidation.length) return;

    const currentWord = wordsNeedingValidation[currentValidationIndex];
    
    // Enregistrer le vote local
    setValidationVotes(prev => ({
      ...prev,
      [currentWord.answerId]: isValid,
    }));

    try {
      // Récupérer les votes existants
      const votes = await onlineService.getWordValidationVotes(currentWord.answerId);
      const myVote = votes.find(v => v.player_id === currentPlayerId);
      
      if (myVote) {
        await onlineService.voteForWordValidation(myVote.id, currentPlayerId, isValid);
      }

      // Vérifier si tous les joueurs ont voté
      const updatedVotes = await onlineService.getWordValidationVotes(currentWord.answerId);
      const allVoted = updatedVotes.every(v => v.vote !== null);

      if (allVoted) {
        // Calculer le résultat (unanimité requise pour valider)
        const allValid = updatedVotes.every(v => v.vote === true);
        const points = allValid ? 2 : 0;

        // Mettre à jour la réponse
        await onlineService.updateAnswerWithManualValidation(currentWord.answerId, allValid, points);

        // Passer au mot suivant ou fermer le modal
        if (currentValidationIndex < wordsNeedingValidation.length - 1) {
          setCurrentValidationIndex(currentValidationIndex + 1);
        } else {
          setShowValidationModal(false);
          // Recharger les résultats avec les scores mis à jour
          await recalculateScores();
        }
      } else {
        // Attendre les autres votes
        Alert.alert('Vote enregistré', 'En attente du vote de votre adversaire...');
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible d\'enregistrer le vote');
    }
  }

  async function recalculateScores() {
    if (!roomId || !roundId) return;

    try {
      // Recharger les réponses avec les validations manuelles
      const updatedAnswers = await onlineService.getRoundAnswers(roundId);
      setAllAnswers(updatedAnswers);

      // Recalculer les scores
      const myUpdatedAnswers = updatedAnswers.filter(a => a.player_id === currentPlayerId);
      const opponentUpdatedAnswers = updatedAnswers.filter(a => a.player_id !== currentPlayerId);

      const myNewScore = myUpdatedAnswers.reduce((sum, a) => sum + a.points, 0);
      const opponentNewScore = opponentUpdatedAnswers.reduce((sum, a) => sum + a.points, 0);

      // Appliquer pénalités si nécessaire
      const myFinalScore = myRoundScore?.penalty_applied 
        ? Math.max(0, myNewScore - 3) 
        : myNewScore;
      const opponentFinalScore = opponentRoundScore?.penalty_applied 
        ? Math.max(0, opponentNewScore - 3) 
        : opponentNewScore;

      // Mettre à jour les scores dans le store
      updateTotalScores(myFinalScore, opponentFinalScore);

      // Recharger les résultats
      await loadResults();
    } catch (error) {
      console.error('Error recalculating scores:', error);
    }
  }

  async function handleNextRound() {
    if (!roomId || !opponent) return;

    try {
      // Ajouter la manche à l'historique
      const roundData: RoundHistory = {
        roundNumber: currentRound,
        letter: currentLetter || '',
        myScore: myRoundScore?.round_score || 0,
        opponentScore: opponentRoundScore?.round_score || 0,
        myValidWords: myRoundScore?.valid_words_count || 0,
        opponentValidWords: opponentRoundScore?.valid_words_count || 0,
      };
      addRoundToHistory(roundData);

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
              myScore: myRoundScore?.round_score || 0,
              opponentScore: opponentRoundScore?.round_score || 0,
              myValidWords: myRoundScore?.valid_words_count || 0,
              opponentValidWords: opponentRoundScore?.valid_words_count || 0,
            };
            addRoundToHistory(roundData);
            updateTotalScores(myRoundScore?.round_score || 0, opponentRoundScore?.round_score || 0);

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

  const myValidAnswers = results.filter((r) => r.isValid).length;
  const myTotalScore = totalScore + (myRoundScore?.round_score || 0);
  const opponentTotal = opponentTotalScore + (opponentRoundScore?.round_score || 0);

  // Modal de validation manuelle
  const currentWordToValidate = wordsNeedingValidation[currentValidationIndex];

  // Résultats finaux
  if (showFinalResults) {
    const isWinner = myTotalScore > opponentTotal;
    const isDraw = myTotalScore === opponentTotal;
    const totalMyValidWords = roundHistory.reduce((sum, r) => sum + r.myValidWords, 0) + myValidAnswers;
    const totalOpponentValidWords = roundHistory.reduce((sum, r) => sum + r.opponentValidWords, 0) + 
                                     (opponentRoundScore?.valid_words_count || 0);

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
                <Text style={styles.historyScore}>Vous: {myRoundScore?.round_score || 0} pts</Text>
                <Text style={styles.historyScore}>{opponent?.player_name}: {opponentRoundScore?.round_score || 0} pts</Text>
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

  // Résultats de manche
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
              <Text style={styles.scoreValue}>{myRoundScore?.round_score || 0}</Text>
              <Text style={styles.validCount}>{myValidAnswers} valides</Text>
              {myRoundScore?.penalty_applied && (
                <Text style={styles.penaltyText}>⚠️ Pénalité -3</Text>
              )}
            </View>
            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>{opponent?.player_name}</Text>
              <Text style={styles.scoreValue}>{opponentRoundScore?.round_score || 0}</Text>
              <Text style={styles.validCount}>{opponentRoundScore?.valid_words_count || 0} valides</Text>
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
      <Modal
        visible={showValidationModal}
        transparent={true}
        animationType="slide"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <HelpCircle size={48} color="#FF9800" />
            <Text style={styles.modalTitle}>Validation manuelle</Text>
            {currentWordToValidate && (
              <>
                <Text style={styles.modalText}>
                  Le mot "<Text style={styles.modalWord}>{currentWordToValidate.word}</Text>" 
                  de {currentWordToValidate.playerName}
                </Text>
                <Text style={styles.modalCategory}>
                  Catégorie: {currentWordToValidate.categoryName}
                </Text>
                <Text style={styles.modalQuestion}>
                  Ce mot est-il valide ?
                </Text>
                <Text style={styles.modalInfo}>
                  Les deux joueurs doivent accepter pour valider
                </Text>
                <View style={styles.modalButtons}>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.rejectButton]}
                    onPress={() => handleValidateWord(false)}
                  >
                    <XCircle size={24} color="#fff" />
                    <Text style={styles.modalButtonText}>Invalide</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.modalButton, styles.acceptButton]}
                    onPress={() => handleValidateWord(true)}
                  >
                    <CheckCircle size={24} color="#fff" />
                    <Text style={styles.modalButtonText}>Valide</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.modalProgress}>
                  {currentValidationIndex + 1} / {wordsNeedingValidation.length}
                </Text>
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
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginTop: 16,
    marginBottom: 16,
  },
  modalText: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalWord: {
    fontWeight: '700',
    color: '#007AFF',
  },
  modalCategory: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  modalQuestion: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  modalInfo: {
    fontSize: 12,
    color: '#999',
    marginBottom: 24,
    textAlign: 'center',
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
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalProgress: {
    fontSize: 14,
    color: '#999',
    marginTop: 16,
  },
});