// app/online-results.tsx - VERSION AMÉLIORÉE avec animations GSAP
import { View, Text, StyleSheet, ScrollView, Alert, Modal, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import Button from '../components/Button';
import { onlineService, GameRoomPlayer, GameRoomAnswer, GameRoundScore } from '../services/online';
import { CheckCircle, XCircle, Trophy, Crown, AlertCircle, Play, StopCircle, Star, Zap, Award } from 'lucide-react-native';
import { GameResult, RoundHistory } from '../store/gameStore';
import { getCategories } from '../services/api';
import { supabase } from '../lib/supabase';
import Animated, { 
  FadeIn, 
  FadeInDown, 
  FadeInUp, 
  SlideInRight, 
  SlideInLeft,
  BounceIn,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withDelay,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const SAFE_AREA_HEIGHT = SCREEN_HEIGHT * 0.25; // 25% pour éviter le clavier

export default function OnlineResultsScreen() {
  const router = useRouter();
  const scrollY = useSharedValue(0);
  const scoreScale = useSharedValue(0);
  const [animatedScore, setAnimatedScore] = useState(0);
  
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
  const [waitingForNextRound, setWaitingForNextRound] = useState(false);

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

  // Animation du score
  useEffect(() => {
    scoreScale.value = withSequence(
      withSpring(1.2, { damping: 2 }),
      withSpring(1, { damping: 8 })
    );
  }, []);

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
      
      // Animer le compteur de score
      const myAnswers = answers.filter(a => a.player_id === currentPlayerId);
      const finalScore = myAnswers.reduce((sum, a) => sum + a.points, 0);
      animateScore(finalScore);
      
    } catch (error) {
      console.error('Error loading results:', error);
    } finally {
      setLoading(false);
    }
  }

  function animateScore(targetScore: number) {
    const duration = 2000;
    const steps = 60;
    const increment = targetScore / steps;
    let current = 0;

    const interval = setInterval(() => {
      current += increment;
      if (current >= targetScore) {
        setAnimatedScore(targetScore);
        clearInterval(interval);
      } else {
        setAnimatedScore(Math.floor(current));
      }
    }, duration / steps);
  }

  if (!results || !roomId || !currentPlayerId || !roundId) {
    router.replace('/');
    return null;
  }

  const opponent = allPlayers.find(p => p.id !== currentPlayerId);
  const myRoundScore = roundScores.find(s => s.player_id === currentPlayerId);
  const opponentRoundScore = roundScores.find(s => s.player_id !== currentPlayerId);

  const myAnswers = allAnswers.filter(a => a.player_id === currentPlayerId);
  const opponentAnswers = allAnswers.filter(a => a.player_id !== currentPlayerId);
  
  function calculateFinalScore(answers: GameRoomAnswer[], roundScore: GameRoundScore | undefined) {
    if (!roundScore) return 0;
    const totalPoints = answers.reduce((sum, a) => sum + a.points, 0);
    const allValid = answers.every(a => !a.word || a.is_valid);
    if (roundScore.stopped_early && !allValid) {
      return Math.max(0, totalPoints - 3);
    }
    return totalPoints;
  }

  const myFinalScore = calculateFinalScore(myAnswers, myRoundScore);
  const opponentFinalScore = calculateFinalScore(opponentAnswers, opponentRoundScore);

  async function handleContestWord(answer: GameRoomAnswer) {
    setContestedWord(answer);
    setMyVote(null);
    setOpponentVote(null);

    const existingVotes = await onlineService.getWordValidationVotes(answer.id);
    
    if (existingVotes.length === 0) {
      await onlineService.createWordValidationVote(
        roomId,
        roundId,
        answer.id,
        answer.word,
        answer.categorie_id,
        allPlayers
      );
    } else {
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
        Alert.alert('Vote enregistré', 'En attente du vote de votre adversaire...');

        let pollCount = 0;
        const maxPolls = 60;

        const checkVotes = setInterval(async () => {
          pollCount++;
          const updatedVotes = await onlineService.getWordValidationVotes(contestedWord.id);
          const allVoted = updatedVotes.every(v => v.vote !== null);

          if (allVoted) {
            clearInterval(checkVotes);
            const allValid = updatedVotes.every(v => v.vote === true);
            const points = allValid ? 2 : 0;

            await onlineService.updateAnswerWithManualValidation(contestedWord.id, allValid, points);
            
            if (roundId) {
              await recalculateRoundScores();
            }

            setShowValidationModal(false);
            Alert.alert(
              'Validation terminée',
              allValid ? 'Le mot a été validé ✅' : 'Le mot a été refusé ❌'
            );
          } else if (pollCount >= maxPolls) {
            clearInterval(checkVotes);
            Alert.alert('Timeout', 'Votre adversaire n\'a pas voté à temps');
          }
        }, 1000);
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible d\'enregistrer le vote');
    }
  }

  async function recalculateRoundScores() {
    if (!roomId || !roundId) return;

    try {
      const updatedAnswers = await onlineService.getRoundAnswers(roundId);
      const players = await onlineService.getPlayers(roomId);

      for (const player of players) {
        const playerAnswers = updatedAnswers.filter(a => a.player_id === player.id);
        const newScore = playerAnswers.reduce((sum, a) => sum + a.points, 0);
        const validWordsCount = playerAnswers.filter(a => a.is_valid).length;

        await supabase
          .from('game_round_scores')
          .update({
            round_score: newScore,
            valid_words_count: validWordsCount,
          })
          .eq('round_id', roundId)
          .eq('player_id', player.id);
      }

      setAllAnswers(updatedAnswers);
    } catch (error) {
      console.error('Error recalculating scores:', error);
    }
  }

  async function handleNextRound() {
    if (!roomId || !opponent || !currentPlayerId) return;

    try {
      await onlineService.setPlayerReady(currentPlayerId, true);
      setWaitingForNextRound(true);

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

      await waitForBothPlayersReady();

      let newRound;
      if (isHost) {
        const newLetter = await onlineService.getNextLetter(roomId);
        newRound = await onlineService.createRound(roomId, currentRound + 1, newLetter);
      } else {
        newRound = await waitForNewRound();
      }

      if (!newRound) throw new Error('Impossible de créer/trouver la nouvelle manche');

      onlineService.setCurrentRoundId(newRound.id);
      startNewRound(newRound.letter);

      const cats = await getCategories();
      startMultiplayerGame(newRound.letter, cats, isHost, opponent.player_name);

      router.replace('/online-game');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de démarrer la manche suivante');
      setWaitingForNextRound(false);
      await onlineService.setPlayerReady(currentPlayerId, false);
    }
  }

  async function waitForBothPlayersReady() {
    return new Promise<void>((resolve, reject) => {
      let checksCount = 0;
      const maxChecks = 120;

      const checkInterval = setInterval(async () => {
        checksCount++;
        const players = await onlineService.getPlayers(roomId);
        const allReady = players.every(p => p.ready_for_next_round === true);

        if (allReady) {
          clearInterval(checkInterval);
          resolve();
        } else if (checksCount >= maxChecks) {
          clearInterval(checkInterval);
          reject(new Error('Timeout'));
        }
      }, 500);
    });
  }

  async function waitForNewRound() {
    return new Promise<any>((resolve, reject) => {
      let checksCount = 0;
      const maxChecks = 60;

      const checkInterval = setInterval(async () => {
        checksCount++;
        const newRound = await onlineService.getCurrentRound(roomId);
        
        if (newRound && newRound.round_number === currentRound + 1) {
          clearInterval(checkInterval);
          resolve(newRound);
        } else if (checksCount >= maxChecks) {
          clearInterval(checkInterval);
          reject(new Error('Timeout'));
        }
      }, 500);
    });
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

  const scoreAnimStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scoreScale.value }],
    };
  });

  if (showFinalResults) {
    const isWinner = myTotalScore > opponentTotal;
    const isDraw = myTotalScore === opponentTotal;

    return (
      <View style={styles.container}>
        <Animated.View 
          entering={FadeIn.duration(600)} 
          style={styles.backgroundGradient}
        />
        
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View 
            entering={ZoomIn.delay(200).springify()} 
            style={styles.winnerSection}
          >
            {isDraw ? (
              <>
                <Trophy size={80} color="#FFD700" />
                <Text style={styles.winnerText}>Égalité ! 🤝</Text>
              </>
            ) : isWinner ? (
              <>
                <Crown size={80} color="#FFD700" />
                <Text style={styles.winnerText}>Victoire ! 🎉</Text>
                <Animated.View entering={FadeInUp.delay(400)} style={styles.confetti}>
                  <Text style={styles.confettiText}>🎊🎊🎊</Text>
                </Animated.View>
              </>
            ) : (
              <>
                <Trophy size={80} color="#999" />
                <Text style={styles.loserText}>Défaite</Text>
                <Text style={styles.winnerName}>{opponent?.player_name} gagne !</Text>
              </>
            )}
          </Animated.View>

          <Animated.View 
            entering={FadeInDown.delay(300).springify()} 
            style={styles.finalScoresCard}
          >
            <View style={styles.cardHeader}>
              <Award size={24} color="#007AFF" />
              <Text style={styles.sectionTitle}>Score final</Text>
            </View>
            
            <View style={styles.finalScoresRow}>
              <Animated.View 
                entering={SlideInLeft.delay(400).springify()}
                style={[styles.finalScoreBlock, isWinner && styles.winnerBlock]}
              >
                <Text style={styles.playerLabel}>Vous</Text>
                <Text style={styles.finalScoreValue}>{myTotalScore}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color="#FFD700" />
                  <Text style={styles.validCount}>
                    {roundHistory.reduce((sum, r) => sum + r.myValidWords, 0) + myAnswers.filter(a => a.is_valid).length} mots
                  </Text>
                </View>
              </Animated.View>

              <Animated.View 
                entering={SlideInRight.delay(400).springify()}
                style={[styles.finalScoreBlock, !isWinner && !isDraw && styles.winnerBlock]}
              >
                <Text style={styles.playerLabel}>{opponent?.player_name}</Text>
                <Text style={styles.finalScoreValue}>{opponentTotal}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color="#FFD700" />
                  <Text style={styles.validCount}>
                    {roundHistory.reduce((sum, r) => sum + r.opponentValidWords, 0) + opponentAnswers.filter(a => a.is_valid).length} mots
                  </Text>
                </View>
              </Animated.View>
            </View>
          </Animated.View>

          <Animated.View 
            entering={FadeInUp.delay(500)} 
            style={styles.historyContainer}
          >
            <Text style={styles.sectionTitle}>Historique ({roundHistory.length + 1} manches)</Text>
            {[...roundHistory, {
              roundNumber: currentRound,
              letter: currentLetter || '',
              myScore: myFinalScore,
              opponentScore: opponentFinalScore,
            }].map((round, index) => (
              <Animated.View 
                key={index}
                entering={FadeInDown.delay(600 + index * 100).springify()}
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
                  <Text style={styles.historyScore}>{opponent?.player_name}: {round.opponentScore}pts</Text>
                </View>
              </Animated.View>
            ))}
          </Animated.View>

          <Animated.View 
            entering={FadeInUp.delay(700)} 
            style={styles.buttonContainer}
          >
            <Button title="Nouvelle partie" onPress={handleNewGame} />
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  if (waitingForNextRound) {
    return (
      <View style={styles.container}>
        <Animated.View entering={FadeIn} style={styles.waitingContainer}>
          <Animated.View entering={BounceIn.delay(200)}>
            <ActivityIndicator size="large" color="#007AFF" />
          </Animated.View>
          <Animated.Text 
            entering={FadeInUp.delay(400)} 
            style={styles.waitingTitle}
          >
            {isHost ? 'Création de la manche...' : 'En attente...'}
          </Animated.Text>
          <Animated.Text 
            entering={FadeInUp.delay(600)} 
            style={styles.waitingText}
          >
            {isHost ? 'Préparation de la nouvelle manche' : `${opponent?.player_name} prépare la manche`}
          </Animated.Text>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.View 
        entering={FadeIn.duration(600)} 
        style={styles.backgroundGradient}
      />
      
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View 
          entering={FadeInDown.delay(100).springify()} 
          style={styles.roundHeader}
        >
          <Text style={styles.roundTitle}>Manche {currentRound}</Text>
          <View style={styles.letterBadge}>
            <Text style={styles.letterText}>{currentLetter}</Text>
          </View>
        </Animated.View>

        <Animated.View 
          entering={ZoomIn.delay(200).springify()}
          style={styles.scoreCard}
        >
          <View style={styles.scoreHeader}>
            <Zap size={24} color="#FFD700" />
            <Text style={styles.scoreLabel}>Score de la manche</Text>
          </View>
          
          <View style={styles.scoresRow}>
            <Animated.View 
              entering={SlideInLeft.delay(300).springify()}
              style={styles.scoreBlock}
            >
              <Text style={styles.playerLabel}>Vous</Text>
              <Animated.Text style={[styles.scoreValue, scoreAnimStyle]}>
                {myFinalScore}
              </Animated.Text>
              <View style={styles.statsRow}>
                <CheckCircle size={16} color="#4caf50" />
                <Text style={styles.validCount}>{myAnswers.filter(a => a.is_valid).length} valides</Text>
              </View>
              {myRoundScore?.stopped_early && myAnswers.some(a => !a.is_valid) && (
                <Text style={styles.penaltyText}>⚠️ -3pts</Text>
              )}
            </Animated.View>

            <Animated.View 
              entering={SlideInRight.delay(300).springify()}
              style={styles.scoreBlock}
            >
              <Text style={styles.playerLabel}>{opponent?.player_name}</Text>
              <Text style={styles.scoreValue}>{opponentFinalScore}</Text>
              <View style={styles.statsRow}>
                <CheckCircle size={16} color="#4caf50" />
                <Text style={styles.validCount}>{opponentAnswers.filter(a => a.is_valid).length} valides</Text>
              </View>
              {opponentRoundScore?.stopped_early && opponentAnswers.some(a => !a.is_valid) && (
                <Text style={styles.penaltyText}>⚠️ -3pts</Text>
              )}
            </Animated.View>
          </View>
        </Animated.View>

        <Animated.View 
          entering={FadeInUp.delay(400)} 
          style={styles.comparisonContainer}
        >
          <Text style={styles.sectionTitle}>Réponses</Text>
          {categories.map((category, index) => {
            const myAnswer = myAnswers.find(a => a.categorie_id === category.id);
            const oppAnswer = opponentAnswers.find(a => a.categorie_id === category.id);

            return (
              <Animated.View 
                key={category.id}
                entering={FadeInDown.delay(500 + index * 50).springify()}
                style={styles.comparisonCard}
              >
                <Text style={styles.categoryName}>{category.nom}</Text>
                <View style={styles.comparisonRow}>
                  <View style={styles.answerBlock}>
                    {myAnswer?.word ? (
                      <View style={styles.answerContainer}>
                        <Text style={styles.answerWord}>{myAnswer.word}</Text>
                        {myAnswer.is_valid ? (
                          <CheckCircle size={20} color="#4caf50" />
                        ) : (
                          <View style={styles.contestRow}>
                            <XCircle size={20} color="#f44336" />
                            <TouchableOpacity onPress={() => handleContestWord(myAnswer)}>
                              <AlertCircle size={20} color="#FF9800" />
                            </TouchableOpacity>
                          </View>
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
                        {oppAnswer.is_valid ? (
                          <CheckCircle size={20} color="#4caf50" />
                        ) : (
                          <View style={styles.contestRow}>
                            <XCircle size={20} color="#f44336" />
                            <TouchableOpacity onPress={() => handleContestWord(oppAnswer)}>
                              <AlertCircle size={20} color="#FF9800" />
                            </TouchableOpacity>
                          </View>
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
        </Animated.View>

        <Animated.View 
          entering={FadeInUp.delay(700)} 
          style={styles.buttonContainer}
        >
          <Button 
            title="Manche suivante" 
            onPress={handleNextRound}
            icon={<Play size={20} color="#fff" />}
          />
          <Button 
            title="Arrêter" 
            onPress={handleStopGame}
            variant="secondary"
            icon={<StopCircle size={20} color="#007AFF" />}
          />
        </Animated.View>
      </ScrollView>

      <Modal visible={showValidationModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <Animated.View 
            entering={ZoomIn.springify()} 
            style={styles.modalContent}
          >
            <AlertCircle size={48} color="#FF9800" />
            <Text style={styles.modalTitle}>Contester le mot</Text>
            {contestedWord && (
              <>
                <Text style={styles.modalText}>
                  <Text style={styles.modalWord}>{contestedWord.word}</Text>
                </Text>
                <Text style={styles.modalCategory}>
                  {categories.find(c => c.id === contestedWord.categorie_id)?.nom}
                </Text>
                <Text style={styles.modalQuestion}>Ce mot est-il valide ?</Text>

                {myVote !== null && (
                  <View style={styles.voteStatusBadge}>
                    <Text style={styles.voteStatus}>
                      {myVote ? '✓ Valide' : '✗ Invalide'}
                    </Text>
                  </View>
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
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#0a0e27' 
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0a0e27',
  },
  scrollContent: { 
    padding: 20, 
    paddingTop: 60, 
    paddingBottom: SAFE_AREA_HEIGHT 
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
    textShadowColor: 'rgba(0, 122, 255, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
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
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.3)',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
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
    letterSpacing: 0.5,
  },
  scoresRow: { 
    flexDirection: 'row', 
    gap: 16 
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
    fontWeight: '500',
  },
  scoreValue: { 
    fontSize: 48, 
    fontWeight: '800', 
    color: '#007AFF',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 122, 255, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
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
    fontWeight: '500',
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
  comparisonContainer: { 
    marginBottom: 24 
  },
  sectionTitle: { 
    fontSize: 20, 
    fontWeight: '700', 
    color: '#fff', 
    marginBottom: 16, 
    textAlign: 'center',
    letterSpacing: 0.5,
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
    opacity: 0.9,
  },
  comparisonRow: { 
    flexDirection: 'row', 
    gap: 12 
  },
  answerBlock: { 
    flex: 1 
  },
  answerContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 8, 
    flexWrap: 'wrap',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: 8,
    borderRadius: 8,
  },
  answerWord: { 
    fontSize: 15, 
    color: '#fff', 
    fontWeight: '600', 
    flex: 1 
  },
  noAnswer: { 
    fontSize: 16, 
    color: 'rgba(255, 255, 255, 0.3)', 
    fontStyle: 'italic',
    textAlign: 'center',
  },
  contestRow: {
    flexDirection: 'row',
    gap: 4,
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
    position: 'relative',
  },
  confetti: {
    position: 'absolute',
    top: -20,
    left: 0,
    right: 0,
  },
  confettiText: {
    fontSize: 32,
    textAlign: 'center',
  },
  winnerText: { 
    fontSize: 36, 
    fontWeight: '800', 
    color: '#4caf50', 
    marginTop: 20,
    textShadowColor: 'rgba(76, 175, 80, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  loserText: { 
    fontSize: 32, 
    fontWeight: '700', 
    color: 'rgba(255, 255, 255, 0.6)', 
    marginTop: 16 
  },
  winnerName: { 
    fontSize: 20, 
    color: '#007AFF', 
    marginTop: 8,
    fontWeight: '600',
  },
  finalScoresCard: { 
    backgroundColor: 'rgba(0, 122, 255, 0.1)', 
    borderRadius: 24, 
    padding: 24, 
    marginBottom: 24,
    borderWidth: 2,
    borderColor: 'rgba(0, 122, 255, 0.3)',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
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
    gap: 16 
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
    shadowColor: '#4caf50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  finalScoreValue: { 
    fontSize: 52, 
    fontWeight: '800', 
    color: '#007AFF', 
    marginBottom: 8,
    textShadowColor: 'rgba(0, 122, 255, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  historyContainer: { 
    marginBottom: 24 
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
    fontWeight: '500',
  },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.8)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20 
  },
  modalContent: { 
    backgroundColor: '#1a1f3a', 
    borderRadius: 24, 
    padding: 28, 
    width: '100%', 
    maxWidth: 400, 
    alignItems: 'center', 
    gap: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 152, 0, 0.3)',
    shadowColor: '#FF9800',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  modalTitle: { 
    fontSize: 24, 
    fontWeight: '800', 
    color: '#fff',
    letterSpacing: 0.5,
  },
  modalText: { 
    fontSize: 18, 
    color: '#fff', 
    textAlign: 'center',
    fontWeight: '500',
  },
  modalWord: { 
    fontWeight: '800', 
    color: '#007AFF',
    fontSize: 20,
  },
  modalCategory: { 
    fontSize: 14, 
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
  },
  modalQuestion: { 
    fontSize: 18, 
    fontWeight: '700', 
    color: '#fff',
    marginTop: 8,
  },
  voteStatusBadge: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  voteStatus: { 
    fontSize: 16, 
    fontWeight: '700', 
    color: '#4caf50' 
  },
  modalButtons: { 
    flexDirection: 'row', 
    gap: 12, 
    width: '100%',
    marginTop: 8,
  },
  modalButton: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8, 
    padding: 16, 
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  acceptButton: { 
    backgroundColor: '#4caf50' 
  },
  rejectButton: { 
    backgroundColor: '#f44336' 
  },
  selectedButton: { 
    opacity: 0.5 
  },
  modalButtonText: { 
    fontSize: 16, 
    fontWeight: '700', 
    color: '#fff' 
  },
  waitingContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 40 
  },
  waitingTitle: { 
    fontSize: 26, 
    fontWeight: '800', 
    color: '#fff', 
    marginTop: 24, 
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  waitingText: { 
    fontSize: 16, 
    color: 'rgba(255, 255, 255, 0.7)', 
    marginTop: 12, 
    textAlign: 'center',
    fontWeight: '500',
  },
});