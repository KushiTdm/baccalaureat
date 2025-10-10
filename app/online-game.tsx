// app/online-game.tsx
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import InputWord from '../components/InputWord';
import Timer from '../components/Timer';
import Button from '../components/Button';
import { validateWord } from '../services/api';
import { onlineService, GameRoomPlayer, EndGameRequest } from '../services/online';
import { GameResult } from '../store/gameStore';
import { Clock, Send, Flag } from 'lucide-react-native';

export default function OnlineGameScreen() {
  const router = useRouter();
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
    setEndGameRequestReceived,
  } = useGameStore();

  const [submitting, setSubmitting] = useState(false);
  const [opponentFinished, setOpponentFinished] = useState(false);
  const [endGameRequestPending, setEndGameRequestPending] = useState(false);
  const [receivedEndGameRequest, setReceivedEndGameRequest] = useState<EndGameRequest | null>(null);

  useEffect(() => {
    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();

    if (!roomId || !playerId) {
      router.replace('/');
      return;
    }

    // Créer ou récupérer la manche actuelle
    initializeRound();

    // Subscribe to room updates
    onlineService.subscribeToRoom(roomId, {
      onPlayerJoined: () => {},
      onPlayerLeft: (leftPlayerId) => {
        if (leftPlayerId !== playerId) {
          Alert.alert(
            'Adversaire déconnecté',
            'Votre adversaire a quitté la partie',
            [{ text: 'OK', onPress: () => router.replace('/') }]
          );
        }
      },
      onGameStarted: () => {},
      onPlayerFinished: (player) => {
        if (player.id !== playerId) {
          setOpponentFinished(true);
          // Si l'adversaire a fini, arrêter aussi
          if (!submitting) {
            Alert.alert(
              'Adversaire a terminé',
              'Votre adversaire a validé toutes ses réponses. La manche se termine.',
              [{ text: 'OK', onPress: () => handleSubmit(false) }]
            );
          }
        }
      },
      onEndGameRequestReceived: (request) => {
        if (request.requester_player_id !== playerId && request.status === 'pending') {
          setReceivedEndGameRequest(request);
          setEndGameRequestReceived(true);
          Alert.alert(
            'Demande de fin',
            `${opponentName} demande à arrêter la partie. Acceptez-vous ?`,
            [
              {
                text: 'Refuser',
                style: 'cancel',
                onPress: () => handleRespondToEndRequest(request.id, false),
              },
              {
                text: 'Accepter',
                onPress: () => handleRespondToEndRequest(request.id, true),
              },
            ]
          );
        }
      },
      onEndGameRequestResponded: (request) => {
        if (request.requester_player_id === playerId) {
          if (request.status === 'accepted') {
            Alert.alert('Accepté', 'Votre adversaire a accepté. La manche se termine.');
            handleSubmit(false); // Pas de pénalité si accepté
          } else if (request.status === 'rejected') {
            Alert.alert('Refusé', 'Votre adversaire a refusé de terminer.');
            setEndGameRequestPending(false);
            setEndGameRequested(false);
          }
        }
      },
    });

    return () => {
      onlineService.unsubscribeFromRoom();
    };
  }, []);

  async function initializeRound() {
    const roomId = onlineService.getCurrentRoomId();
    if (!roomId) return;

    // Vérifier si une manche existe déjà
    let round = await onlineService.getCurrentRound(roomId);

    // Si pas de manche, en créer une (uniquement l'hôte)
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

  if (!currentLetter || categories.length === 0) {
    router.replace('/');
    return null;
  }

  async function handleTimeUp() {
    await handleSubmit(false); // Temps écoulé = pas de pénalité
  }

  async function handleRequestEndGame() {
    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();
    const roundId = onlineService.getCurrentRoundId();

    if (!roomId || !playerId || !roundId) return;

    setEndGameRequestPending(true);
    setEndGameRequested(true);

    try {
      await onlineService.requestEndGame(roomId, roundId, playerId);
      Alert.alert(
        'Demande envoyée',
        'En attente de la réponse de votre adversaire...'
      );
    } catch (error) {
      Alert.alert('Erreur', 'Impossible d\'envoyer la demande');
      setEndGameRequestPending(false);
      setEndGameRequested(false);
    }
  }

  async function handleRespondToEndRequest(requestId: string, accept: boolean) {
    try {
      await onlineService.respondToEndGameRequest(requestId, accept);
      setReceivedEndGameRequest(null);
      setEndGameRequestReceived(false);

      if (accept) {
        await handleSubmit(false); // Pas de pénalité si accord mutuel
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de répondre');
    }
  }

  async function handleSubmit(stoppedEarly: boolean = true) {
    if (submitting) return;

    setSubmitting(true);
    endGame();

    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();
    const roundId = onlineService.getCurrentRoundId();

    if (!roomId || !playerId || !roundId) {
      Alert.alert('Erreur', 'Impossible de soumettre les réponses');
      router.replace('/');
      return;
    }

    try {
      // Valider les réponses du joueur
      const myResults: GameResult[] = [];
      let myScore = 0;
      let hasInvalidWord = false;
      const allFieldsFilled = answers.length === categories.length && 
                              answers.every(a => a.word.trim() !== '');

      for (const category of categories) {
        const answer = answers.find((a) => a.categorieId === category.id);
        const word = answer?.word || '';

        let isValid = false;
        let points = 0;
        let needsManualValidation = false;

        if (word.trim() && word.toLowerCase().startsWith(currentLetter.toLowerCase())) {
          try {
            isValid = await validateWord(word, category.id);
            
            if (isValid) {
              points = 2; // 2 points par bonne réponse
            } else {
              hasInvalidWord = true;
              needsManualValidation = true; // Proposer validation manuelle
            }
            
            myScore += points;
          } catch (error) {
            // En cas d'erreur de validation, proposer validation manuelle
            needsManualValidation = true;
          }
        }

        myResults.push({
          categorieId: category.id,
          categorieName: category.nom,
          word,
          isValid,
          points,
          needsManualValidation,
        });

        // Soumettre la réponse
        if (word.trim()) {
          try {
            await onlineService.submitAnswer(
              roomId,
              playerId,
              roundId,
              category.id,
              word,
              isValid,
              points,
              needsManualValidation
            );
          } catch (error) {
            console.error('Error submitting answer:', error);
          }
        }
      }

      // Appliquer pénalité si arrêt prématuré avec mot invalide
      let penaltyApplied = false;
      if (stoppedEarly && allFieldsFilled && hasInvalidWord) {
        const penalty = 3;
        myScore = Math.max(0, myScore - penalty); // Score ne peut pas être négatif
        penaltyApplied = true;
      }

      // Soumettre le score de manche
      const validWordsCount = myResults.filter(r => r.isValid).length;
      await onlineService.submitRoundScore(
        roundId,
        playerId,
        myScore,
        validWordsCount,
        stoppedEarly && allFieldsFilled,
        penaltyApplied
      );

      // Attendre l'adversaire si pas encore fini
      if (!opponentFinished) {
        Alert.alert(
          'Réponses envoyées',
          "En attente de votre adversaire...",
          [{ text: 'OK' }]
        );

        await waitForOpponent(60000); // Max 60 secondes
      }

      setMultiplayerResults(myResults, myScore, stoppedEarly && allFieldsFilled);
      router.push('/online-results');
    } catch (error) {
      console.error('Submit error:', error);
      Alert.alert('Erreur', 'Impossible de valider les réponses');
      router.replace('/');
    } finally {
      setSubmitting(false);
    }
  }

  function waitForOpponent(timeout: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, timeout);

      const checkInterval = setInterval(async () => {
        if (opponentFinished) {
          clearTimeout(timer);
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });
  }

  // Vérifier si tous les champs sont remplis
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
          {opponentFinished && (
            <Text style={styles.opponentStatus}>✓ Terminé</Text>
          )}
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
          <Button
            title="Valider tous les mots"
            onPress={() => handleSubmit(true)}
            loading={submitting}
            disabled={!allFieldsFilled || endGameRequestPending}
            icon={<Send size={20} color="#fff" />}
          />

          <Button
            title="Demander la fin"
            onPress={handleRequestEndGame}
            variant="secondary"
            disabled={endGameRequestPending || submitting}
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
  opponentStatus: {
    fontSize: 12,
    color: '#4caf50',
    marginTop: 4,
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