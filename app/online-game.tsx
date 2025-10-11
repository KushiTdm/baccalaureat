// app/online-game.tsx - FIX du useEffect
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import InputWord from '../components/InputWord';
import Timer from '../components/Timer';
import Button from '../components/Button';
import { validateWord } from '../services/api';
import { onlineService, EndGameRequest } from '../services/online';
import { GameResult } from '../store/gameStore';
import { Send, Flag, Clock } from 'lucide-react-native';

export default function OnlineGameScreen() {
  const router = useRouter();
  const {
    currentLetter,
    categories,
    answers, // ✅ Garder pour le rendu
    setAnswer,
    setMultiplayerResults,
    endGame,
    opponentName,
    currentRound,
    setEndGameRequested,
  } = useGameStore();

  // ✅ FIX: Fonction pour lire answers du store dans les callbacks asynchrones
  const getAnswers = () => useGameStore.getState().answers;

  const [submitting, setSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [endGameRequestPending, setEndGameRequestPending] = useState(false);
  const [receivedEndGameRequest, setReceivedEndGameRequest] = useState<EndGameRequest | null>(null);
  const [opponentFinished, setOpponentFinished] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const requestCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();

    // ✅ FIX: Ne vérifier que roomId et playerId ici
    if (!roomId || !playerId) {
      console.error('❌ Missing room or player ID');
      router.replace('/');
      return;
    }

    console.log('✅ Starting game with room:', roomId, 'player:', playerId);

    // ✅ Démarrer le polling immédiatement
    startPolling();
    startRequestPolling();
    
    // Initialiser le round en parallèle
    initializeRound();

    return () => {
      stopPolling();
      stopRequestPolling();
      onlineService.unsubscribeFromRoom();
    };
  }, []);

  async function initializeRound() {
    const roomId = onlineService.getCurrentRoomId();
    if (!roomId) return;

    console.log('🎲 Initializing round for room:', roomId);

    let round = await onlineService.getCurrentRound(roomId);

    if (!round) {
      console.log('📝 No current round, creating new one...');
      const room = await onlineService.getRoom(roomId);
      if (room) {
        round = await onlineService.createRound(roomId, currentRound, room.letter);
        console.log('✅ Round created:', round.id);
      }
    } else {
      console.log('✅ Current round found:', round.id);
    }

    if (round) {
      onlineService.setCurrentRoundId(round.id);
    }
  }

  function startPolling() {
    pollingIntervalRef.current = setInterval(async () => {
      await checkOpponentStatus();
    }, 500); // ✅ Vérifier toutes les 500ms au lieu de 1000ms
  }

  function stopPolling() {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }

  // Polling pour vérifier les demandes de fin reçues
  function startRequestPolling() {
    requestCheckIntervalRef.current = setInterval(async () => {
      await checkEndGameRequests();
    }, 2000); // Vérifier toutes les 2 secondes
  }

  function stopRequestPolling() {
    if (requestCheckIntervalRef.current) {
      clearInterval(requestCheckIntervalRef.current);
      requestCheckIntervalRef.current = null;
    }
  }

  async function checkEndGameRequests() {
    if (hasSubmitted || endGameRequestPending) return;

    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();
    const roundId = onlineService.getCurrentRoundId();

    if (!roomId || !playerId || !roundId) return;

    try {
      const request = await onlineService.getPendingEndGameRequest(roomId, roundId);

      if (request && request.requester_player_id !== playerId && !receivedEndGameRequest) {
        setReceivedEndGameRequest(request);
        stopRequestPolling(); // Arrêter le polling pendant la demande

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
                startRequestPolling(); // Redémarrer le polling
              },
            },
            {
              text: 'Accepter',
              onPress: async () => {
                await onlineService.respondToEndGameRequest(request.id, true);
                setReceivedEndGameRequest(null);
                await handleSubmit(false); // Pas de pénalité
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
    if (hasSubmitted) {
      console.log('⏭️ Already submitted, skipping check');
      return;
    }

    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();
    const roundId = onlineService.getCurrentRoundId();

    if (!roomId || !playerId || !roundId) return;

    try {
      const scores = await onlineService.getRoundScores(roundId);
      const opponentScore = scores.find(s => s.player_id !== playerId);

      if (opponentScore && opponentScore.finished_at && !submitting) {
        console.log('🛑 Opponent finished! Auto-submitting...');
        
        // ✅ FIX: Lire answers directement du store
        const currentAnswers = getAnswers();
        console.log('📋 Current answers in state:', currentAnswers);
        console.log('📊 Answers count:', currentAnswers.length, '/ Categories:', categories.length);
        
        stopPolling();
        stopRequestPolling();
        
        // ✅ Afficher un message visuel
        setOpponentFinished(true);
        
        // ✅ Soumettre après 1 seconde pour laisser voir le message
        setTimeout(async () => {
          console.log('⏰ Timeout reached, submitting now...');
          const answersAtSubmit = getAnswers();
          console.log('📋 Answers at submit time:', answersAtSubmit);
          await handleAutoSubmit();
        }, 1000);
      }
    } catch (error) {
      console.error('Error checking opponent:', error);
    }
  }

  if (!currentLetter || categories.length === 0) {
    console.error('❌ Missing game data, redirecting...');
    router.replace('/');
    return null;
  }

  async function handleTimeUp() {
    await handleSubmit(false);
  }

  async function handleRequestEndGame() {
    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();
    const roundId = onlineService.getCurrentRoundId();

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
              
              // Polling pour la réponse
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

              // Timeout après 30 secondes
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
    // ✅ FIX: Lire answers directement du store
    const currentAnswers = getAnswers();
    console.log('🤖 AUTO-SUBMIT TRIGGERED');
    console.log('📋 Current answers:', currentAnswers);
    console.log('📊 Answers count:', currentAnswers.length);
    console.log('🎯 Categories:', categories.map(c => c.nom));
    
    // ✅ FIX: Le joueur 2 n'a PAS arrêté volontairement, mais on doit valider ce qu'il a écrit
    await handleSubmit(false); // false = pas de pénalité car pas de sa faute
  }

  async function handleSubmit(stoppedEarly: boolean = true) {
    console.log('🚀 HANDLE SUBMIT CALLED');
    console.log('   - stoppedEarly:', stoppedEarly);
    console.log('   - submitting:', submitting);
    console.log('   - hasSubmitted:', hasSubmitted);
    
    if (submitting || hasSubmitted) {
      console.log('⚠️ Already submitting or submitted, aborting');
      return;
    }

    console.log('✅ Proceeding with submission...');
    
    setSubmitting(true);
    setHasSubmitted(true);
    stopPolling();
    stopRequestPolling();
    endGame();

    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();
    const roundId = onlineService.getCurrentRoundId();

    console.log('🔑 IDs:', { roomId, playerId, roundId });

    if (!roomId || !playerId || !roundId) {
      console.error('❌ Missing required IDs');
      Alert.alert('Erreur', 'Impossible de soumettre les réponses');
      router.replace('/');
      return;
    }

    try {
      // ✅ FIX CRITIQUE: Lire answers directement du store au moment de la soumission
      const answers = getAnswers();
      
      const myResults: GameResult[] = [];
      let myScore = 0;
      let hasInvalidWord = false;
      const allFieldsFilled = answers.length === categories.length && 
                              answers.every(a => a.word.trim() !== '');

      console.log('📝 Submitting answers:', answers.length, 'categories:', categories.length);
      console.log('📋 Answers:', answers.map(a => `${a.categorieName}: "${a.word}"`));
      console.log('🎯 Stopped early:', stoppedEarly, 'All fields filled:', allFieldsFilled);

      for (const category of categories) {
        const answer = answers.find((a) => a.categorieId === category.id);
        const word = answer?.word?.trim() || '';

        console.log(`🔍 Checking category "${category.nom}": word="${word}"`);

        let isValid = false;
        let points = 0;

        // ✅ FIX: Valider tous les mots saisis, peu importe si tous les champs sont remplis
        if (word) {
          if (word.toLowerCase().startsWith(currentLetter.toLowerCase())) {
            try {
              console.log(`  ✅ Word starts with ${currentLetter}, validating...`);
              isValid = await validateWord(word, category.id);
              
              if (isValid) {
                points = 2;
                myScore += points;
                console.log(`  ✅ Valid! +${points} points`);
              } else {
                hasInvalidWord = true;
                console.log(`  ❌ Invalid word`);
              }
            } catch (error) {
              console.error('  ❌ Validation error:', error);
            }
          } else {
            // Mot ne commence pas par la bonne lettre
            hasInvalidWord = true;
            console.log(`  ❌ Does not start with ${currentLetter}`);
          }
        } else {
          console.log(`  ⚪ Empty field`);
        }

        myResults.push({
          categorieId: category.id,
          categorieName: category.nom,
          word,
          isValid,
          points,
        });

        // ✅ Soumettre tous les mots, même vides
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

      // Appliquer pénalité si arrêt prématuré avec mot invalide
      let penaltyApplied = false;
      if (stoppedEarly && allFieldsFilled && hasInvalidWord) {
        const penalty = 3;
        myScore = Math.max(0, myScore - penalty);
        penaltyApplied = true;
        console.log('⚠️ Penalty applied:', penalty, 'New score:', myScore);
      }

      console.log('✅ Final score:', myScore, 'Valid words:', myResults.filter(r => r.isValid).length);

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

      // ✅ FIX: Attendre que l'adversaire ait aussi soumis
      console.log('⏳ Waiting for opponent to submit...');
      const bothSubmitted = await waitForOpponentSubmission();

      if (bothSubmitted) {
        console.log('✅ Both players submitted, going to results');
      } else {
        console.log('⏰ Timeout, going to results anyway');
      }

      router.push('/online-results');
    } catch (error) {
      console.error('Submit error:', error);
      Alert.alert('Erreur', 'Impossible de valider les réponses');
    } finally {
      setSubmitting(false);
    }
  }

  async function waitForOpponentSubmission(): Promise<boolean> {
    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();
    const roundId = onlineService.getCurrentRoundId();

    if (!roomId || !playerId || !roundId) return false;

    return new Promise<boolean>((resolve) => {
      let checksCount = 0;
      const maxChecks = 60; // 30 secondes max (60 * 500ms)

      const checkInterval = setInterval(async () => {
        checksCount++;
        
        try {
          const scores = await onlineService.getRoundScores(roundId);
          console.log(`🔍 Check ${checksCount}/${maxChecks}: ${scores.length} scores found`);
          
          if (scores.length >= 2) {
            console.log('✅ Both players have submitted!');
            clearInterval(checkInterval);
            // Attendre 500ms de plus pour être sûr que tout est bien enregistré
            setTimeout(() => resolve(true), 500);
          } else if (checksCount >= maxChecks) {
            console.log('⏰ Timeout waiting for opponent');
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.roundInfo}>
          <Text style={styles.roundLabel}>Manche {currentRound}</Text>
        </View>
        <View style={styles.letterContainer}>
          <Text style={styles.letterLabel}>Lettre</Text>
          <Text style={styles.letter}>{currentLetter.toUpperCase()}</Text>
        </View>
        <View style={styles.opponentInfo}>
          <Text style={styles.opponentLabel}>VS</Text>
          <Text style={styles.opponentName}>{opponentName}</Text>
        </View>
        <Timer onTimeUp={handleTimeUp} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {categories.map((category) => {
          const answer = answers.find((a) => a.categorieId === category.id);
          return (
            <InputWord
              key={category.id}
              category={category.nom}
              value={answer?.word || ''}
              onChangeText={(text) => setAnswer(category.id, text)}
              letter={currentLetter}
            />
          );
        })}

        <View style={styles.actionsContainer}>
          {opponentFinished && (
            <View style={styles.opponentFinishedNotice}>
              <Flag size={20} color="#ff9800" />
              <Text style={styles.opponentFinishedText}>
                {opponentName} a validé ! Fin de la manche...
              </Text>
            </View>
          )}

          <Button
            title="Valider tous les mots"
            onPress={() => handleSubmit(true)}
            loading={submitting}
            disabled={!allFieldsFilled || endGameRequestPending || opponentFinished}
            icon={<Send size={20} color="#fff" />}
          />

          <Button
            title="Demander la fin"
            onPress={handleRequestEndGame}
            variant="secondary"
            disabled={endGameRequestPending || submitting || opponentFinished}
            icon={<Flag size={20} color="#007AFF" />}
          />

          {endGameRequestPending && (
            <View style={styles.waitingNotice}>
              <Clock size={16} color="#666" />
              <Text style={styles.waitingText}>
                En attente de la réponse...
              </Text>
            </View>
          )}

          {receivedEndGameRequest && (
            <View style={styles.requestNotice}>
              <Text style={styles.requestText}>
                {opponentName} demande à arrêter
              </Text>
            </View>
          )}
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
  header: {
    backgroundColor: '#fff',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  roundInfo: {
    alignItems: 'center',
    marginBottom: 8,
  },
  roundLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  letterContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  letterLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  letter: {
    fontSize: 48,
    fontWeight: '700',
    color: '#007AFF',
  },
  opponentInfo: {
    alignItems: 'center',
    marginBottom: 16,
  },
  opponentLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  opponentName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  actionsContainer: {
    marginTop: 24,
    gap: 12,
  },
  opponentFinishedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: '#fff3e0',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ff9800',
  },
  opponentFinishedText: {
    fontSize: 16,
    color: '#e65100',
    fontWeight: '700',
  },
  waitingNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: '#fff3cd',
    borderRadius: 8,
  },
  waitingText: {
    fontSize: 14,
    color: '#666',
  },
  requestNotice: {
    padding: 12,
    backgroundColor: '#d1ecf1',
    borderRadius: 8,
    alignItems: 'center',
  },
  requestText: {
    fontSize: 14,
    color: '#0c5460',
    fontWeight: '600',
  },
});