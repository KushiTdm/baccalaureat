// app/online-game.tsx - VERSION AMÉLIORÉE avec animations
import { View, Text, StyleSheet, ScrollView, Alert, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import InputWord from '../components/InputWord';
import Timer from '../components/Timer';
import Button from '../components/Button';
import { validateWord } from '../services/api';
import { onlineService, EndGameRequest } from '../services/online';
import { GameResult } from '../store/gameStore';
import { Send, Flag, Clock, Zap, Users, Trophy, AlertCircle } from 'lucide-react-native';
import Animated, { 
  FadeIn, 
  FadeInDown, 
  FadeInUp, 
  SlideInRight,
  SlideInLeft,
  BounceIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SAFE_AREA_HEIGHT = SCREEN_HEIGHT * 0.25;

export default function OnlineGameScreen() {
  const router = useRouter();
  const pulseAnim = useSharedValue(1);
  const shakeAnim = useSharedValue(0);
  
  const {
    currentLetter,
    categories,
    answers,
    setAnswer,
    setMultiplayerResults,
    endGame,
    opponentName,
    currentRound,
    setEndGameRequested,
  } = useGameStore();

  const getAnswers = () => useGameStore.getState().answers;

  const [submitting, setSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [endGameRequestPending, setEndGameRequestPending] = useState(false);
  const [receivedEndGameRequest, setReceivedEndGameRequest] = useState<EndGameRequest | null>(null);
  const [opponentFinished, setOpponentFinished] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const requestCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const roomId = onlineService.getCurrentRoomId();
  const playerId = onlineService.getCurrentPlayerId();
  const roundId = onlineService.getCurrentRoundId();

  useEffect(() => {
    if (!roomId || !playerId) {
      router.replace('/');
      return;
    }

    // Animation du pulse pour la lettre
    pulseAnim.value = withRepeat(
      withSequence(
        withSpring(1.1, { damping: 2 }),
        withSpring(1, { damping: 2 })
      ),
      -1,
      true
    );

    startPolling();
    startRequestPolling();
    initializeRound();

    return () => {
      stopPolling();
      stopRequestPolling();
      onlineService.unsubscribeFromRoom();
    };
  }, []);

  async function initializeRound() {
    if (!roomId) return;

    let round = await onlineService.getCurrentRound(roomId);

    if (!round) {
      const room = await onlineService.getRoom(roomId);
      if (room) {
        round = await onlineService.createRound(roomId, currentRound, room.letter);
      }
    }

    if (round) {
      onlineService.setCurrentRoundId(round.id);
    }
  }

  function startPolling() {
    pollingIntervalRef.current = setInterval(async () => {
      await checkOpponentStatus();
    }, 500);
  }

  function stopPolling() {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }

  function startRequestPolling() {
    requestCheckIntervalRef.current = setInterval(async () => {
      await checkEndGameRequests();
    }, 2000);
  }

  function stopRequestPolling() {
    if (requestCheckIntervalRef.current) {
      clearInterval(requestCheckIntervalRef.current);
      requestCheckIntervalRef.current = null;
    }
  }

  async function checkEndGameRequests() {
    if (hasSubmitted || endGameRequestPending) return;
    if (!roomId || !playerId || !roundId) return;

    try {
      const request = await onlineService.getPendingEndGameRequest(roomId, roundId);

      if (request && request.requester_player_id !== playerId && !receivedEndGameRequest) {
        setReceivedEndGameRequest(request);
        stopRequestPolling();

        Alert.alert(
          'Demande de fin',
          `${opponentName} demande à arrêter la manche. Acceptez-vous ?`,
          [
            {
              text: 'Refuser',
              style: 'cancel',
              onPress: async () => {
                await onlineService.respondToEndGameRequest(request.id, false);
                setReceivedEndGameRequest(null);
                startRequestPolling();
              },
            },
            {
              text: 'Accepter',
              onPress: async () => {
                await onlineService.respondToEndGameRequest(request.id, true);
                setReceivedEndGameRequest(null);
                await handleSubmit(false);
              },
            },
          ],
          { cancelable: false }
        );
      }
    } catch (error) {
      console.error('Error checking requests:', error);
    }
  }

  async function checkOpponentStatus() {
    if (hasSubmitted || !roomId || !playerId || !roundId) return;

    try {
      const scores = await onlineService.getRoundScores(roundId);
      const opponentScore = scores.find(s => s.player_id !== playerId);

      if (opponentScore && opponentScore.finished_at && !submitting) {
        stopPolling();
        stopRequestPolling();
        setOpponentFinished(true);

        // Animation de shake
        shakeAnim.value = withSequence(
          withTiming(10, { duration: 100 }),
          withTiming(-10, { duration: 100 }),
          withTiming(10, { duration: 100 }),
          withTiming(0, { duration: 100 })
        );

        setTimeout(async () => {
          await handleAutoSubmit();
        }, 1000);
      }
    } catch (error) {
      console.error('Error checking opponent:', error);
    }
  }

  if (!currentLetter || categories.length === 0) {
    router.replace('/');
    return null;
  }

  async function handleTimeUp() {
    await handleSubmit(false);
  }

  async function handleRequestEndGame() {
    if (!roomId || !playerId || !roundId) {
      Alert.alert('Erreur', 'Données de partie manquantes');
      return;
    }

    Alert.alert(
      'Demander la fin',
      'Voulez-vous demander à votre adversaire d\'arrêter la manche ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Envoyer',
          onPress: async () => {
            setEndGameRequestPending(true);
            setEndGameRequested(true);

            try {
              await onlineService.requestEndGame(roomId, roundId, playerId);
              
              let responseReceived = false;
              const checkResponse = setInterval(async () => {
                const request = await onlineService.getPendingEndGameRequest(roomId, roundId);
                
                if (request && request.requester_player_id === playerId && request.status !== 'pending') {
                  clearInterval(checkResponse);
                  setEndGameRequestPending(false);
                  responseReceived = true;
                  
                  if (request.status === 'accepted') {
                    Alert.alert('Accepté', 'Votre adversaire a accepté. La manche se termine.');
                    await handleSubmit(false);
                  } else {
                    Alert.alert('Refusé', 'Votre adversaire a refusé.');
                    setEndGameRequested(false);
                  }
                }
              }, 1000);

              setTimeout(() => {
                if (!responseReceived) {
                  clearInterval(checkResponse);
                  Alert.alert('Délai expiré', 'Pas de réponse de votre adversaire.');
                  setEndGameRequestPending(false);
                  setEndGameRequested(false);
                }
              }, 30000);

            } catch (error) {
              Alert.alert('Erreur', 'Impossible d\'envoyer la demande');
              setEndGameRequestPending(false);
              setEndGameRequested(false);
            }
          },
        },
      ]
    );
  }

  async function handleAutoSubmit() {
    await handleSubmit(false);
  }

  async function handleSubmit(stoppedEarly: boolean = true) {
    if (submitting || hasSubmitted) return;

    setSubmitting(true);
    setHasSubmitted(true);
    stopPolling();
    stopRequestPolling();
    endGame();

    if (!roomId || !playerId || !roundId) {
      Alert.alert('Erreur', 'Impossible de soumettre les réponses');
      router.replace('/');
      return;
    }

    try {
      const answers = getAnswers();
      const myResults: GameResult[] = [];
      let myScore = 0;
      let hasInvalidWord = false;
      const allFieldsFilled = answers.length === categories.length && 
                              answers.every(a => a.word.trim() !== '');

      for (const category of categories) {
        const answer = answers.find((a) => a.categorieId === category.id);
        const word = answer?.word?.trim() || '';

        let isValid = false;
        let points = 0;

        if (word) {
          if (currentLetter && word.toLowerCase().startsWith(currentLetter.toLowerCase())) {
            try {
              isValid = await validateWord(word, category.id);
              
              if (isValid) {
                points = 2;
                myScore += points;
              } else {
                hasInvalidWord = true;
              }
            } catch (error) {
              console.error('Validation error:', error);
            }
          } else {
            hasInvalidWord = true;
          }
        }

        myResults.push({
          categorieId: category.id,
          categorieName: category.nom,
          word,
          isValid,
          points,
        });

        try {
          await onlineService.submitAnswer(
            roomId,
            playerId,
            roundId,
            category.id,
            word,
            isValid,
            points,
            false
          );
        } catch (error) {
          console.error('Error submitting answer:', error);
        }
      }

      let penaltyApplied = false;
      if (stoppedEarly && allFieldsFilled && hasInvalidWord) {
        const penalty = 3;
        myScore = Math.max(0, myScore - penalty);
        penaltyApplied = true;
      }

      const validWordsCount = myResults.filter(r => r.isValid).length;
      await onlineService.submitRoundScore(
        roundId,
        playerId,
        myScore,
        validWordsCount,
        stoppedEarly && allFieldsFilled,
        penaltyApplied
      );

      setMultiplayerResults(myResults, myScore, stoppedEarly && allFieldsFilled);

      await waitForOpponentSubmission();
      router.push('/online-results');
    } catch (error) {
      console.error('Submit error:', error);
      Alert.alert('Erreur', 'Impossible de valider les réponses');
    } finally {
      setSubmitting(false);
    }
  }

  async function waitForOpponentSubmission(): Promise<boolean> {
    if (!roomId || !playerId || !roundId) return false;

    return new Promise<boolean>((resolve) => {
      let checksCount = 0;
      const maxChecks = 60;

      const checkInterval = setInterval(async () => {
        checksCount++;
        
        try {
          const scores = await onlineService.getRoundScores(roundId);
          
          if (scores.length >= 2) {
            clearInterval(checkInterval);
            setTimeout(() => resolve(true), 500);
          } else if (checksCount >= maxChecks) {
            clearInterval(checkInterval);
            resolve(false);
          }
        } catch (error) {
          console.error('Error checking scores:', error);
        }
      }, 500);
    });
  }

  const allFieldsFilled = answers.length === categories.length && 
                          answers.every(a => a.word.trim() !== '');

  const pulseStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: pulseAnim.value }],
    };
  });

  const shakeStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: shakeAnim.value }],
    };
  });

  const filledCount = answers.filter(a => a.word.trim() !== '').length;
  const progressPercent = (filledCount / categories.length) * 100;

  return (
    <View style={styles.container}>
      <Animated.View 
        entering={FadeIn.duration(600)} 
        style={styles.backgroundGradient}
      />
      
      <Animated.View 
        entering={SlideInRight.springify()} 
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <Animated.View 
            entering={FadeInDown.delay(100).springify()}
            style={styles.roundBadge}
          >
            <Trophy size={16} color="#FFD700" />
            <Text style={styles.roundLabel}>Manche {currentRound}</Text>
          </Animated.View>

          <Animated.View 
            entering={FadeInDown.delay(200).springify()}
            style={styles.opponentBadge}
          >
            <Users size={16} color="#007AFF" />
            <Text style={styles.opponentName}>{opponentName}</Text>
          </Animated.View>
        </View>

        <Animated.View 
          entering={BounceIn.delay(300)}
          style={[styles.letterContainer, pulseStyle]}
        >
          <Text style={styles.letterLabel}>Lettre</Text>
          <View style={styles.letterCircle}>
            <Text style={styles.letter}>{currentLetter.toUpperCase()}</Text>
          </View>
        </Animated.View>

        <Animated.View 
          entering={FadeInUp.delay(400)}
          style={styles.progressContainer}
        >
          <View style={styles.progressBar}>
            <Animated.View 
              style={[
                styles.progressFill, 
                { width: `${progressPercent}%` }
              ]} 
            />
          </View>
          <Text style={styles.progressText}>
            {filledCount}/{categories.length} catégories
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(500)}>
          <Timer onTimeUp={handleTimeUp} />
        </Animated.View>
      </Animated.View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {categories.map((category, index) => {
          const answer = answers.find((a) => a.categorieId === category.id);
          return (
            <Animated.View
              key={category.id}
              entering={FadeInDown.delay(600 + index * 50).springify()}
            >
              <InputWord
                category={category.nom}
                value={answer?.word || ''}
                onChangeText={(text) => setAnswer(category.id, text)}
                letter={currentLetter}
              />
            </Animated.View>
          );
        })}

        <Animated.View 
          entering={FadeInUp.delay(800)} 
          style={styles.actionsContainer}
        >
          {opponentFinished && (
            <Animated.View 
              entering={BounceIn}
              style={[styles.opponentFinishedNotice, shakeStyle]}
            >
              <Zap size={24} color="#ff9800" />
              <View style={styles.noticeTextContainer}>
                <Text style={styles.opponentFinishedTitle}>
                  {opponentName} a terminé !
                </Text>
                <Text style={styles.opponentFinishedText}>
                  Validation automatique dans 1 seconde...
                </Text>
              </View>
            </Animated.View>
          )}

          <Button
            title={submitting ? "Envoi en cours..." : "Valider mes réponses"}
            onPress={() => handleSubmit(true)}
            loading={submitting}
            disabled={!allFieldsFilled || endGameRequestPending || opponentFinished}
            icon={<Send size={20} color="#fff" />}
          />

          <Button
            title="Demander l'arrêt"
            onPress={handleRequestEndGame}
            variant="secondary"
            disabled={endGameRequestPending || submitting || opponentFinished}
            icon={<Flag size={20} color="#007AFF" />}
          />

          {endGameRequestPending && (
            <Animated.View 
              entering={FadeInDown.springify()}
              style={styles.waitingNotice}
            >
              <Clock size={20} color="#FF9800" />
              <Text style={styles.waitingText}>
                En attente de la réponse de {opponentName}...
              </Text>
            </Animated.View>
          )}

          {receivedEndGameRequest && (
            <Animated.View 
              entering={BounceIn}
              style={styles.requestNotice}
            >
              <AlertCircle size={20} color="#007AFF" />
              <Text style={styles.requestText}>
                {opponentName} demande à arrêter la manche
              </Text>
            </Animated.View>
          )}

          {!allFieldsFilled && (
            <Animated.View 
              entering={FadeIn.delay(1000)}
              style={styles.hintBox}
            >
              <AlertCircle size={16} color="#FF9800" />
              <Text style={styles.hintText}>
                Remplissez toutes les catégories pour valider
              </Text>
            </Animated.View>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e27',
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0a0e27',
  },
  header: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  roundBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.3)',
  },
  roundLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFD700',
  },
  opponentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.3)',
  },
  opponentName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#007AFF',
  },
  letterContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  letterLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
  letterCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0, 122, 255, 0.15)',
    borderWidth: 3,
    borderColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  letter: {
    fontSize: 48,
    fontWeight: '800',
    color: '#007AFF',
    textShadowColor: 'rgba(0, 122, 255, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBar: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4caf50',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: SAFE_AREA_HEIGHT,
  },
  actionsContainer: {
    marginTop: 24,
    gap: 12,
  },
  opponentFinishedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#ff9800',
    shadowColor: '#ff9800',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  noticeTextContainer: {
    flex: 1,
  },
  opponentFinishedTitle: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '800',
    marginBottom: 4,
  },
  opponentFinishedText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
  },
  waitingNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 152, 0, 0.3)',
  },
  waitingText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
  },
  requestNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.3)',
  },
  requestText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '700',
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 152, 0, 0.2)',
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '500',
  },
});