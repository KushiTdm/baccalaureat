// app/online-game.tsx
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import InputWord from '../components/InputWord';
import Timer from '../components/Timer';
import Button from '../components/Button';
import { validateWord } from '../services/api';
import { onlineService, GameRoomPlayer } from '../services/online';
import { GameResult } from '../store/gameStore';

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
  } = useGameStore();

  const [submitting, setSubmitting] = useState(false);
  const [opponentFinished, setOpponentFinished] = useState(false);

  useEffect(() => {
    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();

    if (!roomId || !playerId) {
      router.replace('/');
      return;
    }

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
        }
      },
    });

    return () => {
      onlineService.unsubscribeFromRoom();
    };
  }, []);

  if (!currentLetter || categories.length === 0) {
    router.replace('/');
    return null;
  }

  async function handleTimeUp() {
    await handleSubmit();
  }

  async function handleSubmit() {
    setSubmitting(true);
    endGame();

    const roomId = onlineService.getCurrentRoomId();
    const playerId = onlineService.getCurrentPlayerId();

    if (!roomId || !playerId) {
      Alert.alert('Erreur', 'Impossible de soumettre les réponses');
      router.replace('/');
      return;
    }

    try {
      // Validate player's answers
      const myResults: GameResult[] = [];
      let myScore = 0;

      for (const category of categories) {
        const answer = answers.find((a) => a.categorieId === category.id);
        const word = answer?.word || '';

        let isValid = false;
        let points = 0;

        if (word.trim() && word.toLowerCase().startsWith(currentLetter.toLowerCase())) {
          isValid = await validateWord(word, category.id);
          points = isValid ? 10 : 0;
          myScore += points;
        }

        myResults.push({
          categorieId: category.id,
          categorieName: category.nom,
          word,
          isValid,
          points,
        });

        // Submit answer to database
        if (word.trim()) {
          try {
            await onlineService.submitAnswer(
              roomId,
              playerId,
              category.id,
              word,
              isValid,
              points
            );
          } catch (error) {
            console.error('Error submitting answer:', error);
          }
        }
      }

      // Mark player as finished with their score
      await onlineService.finishPlayer(playerId, myScore);

      // Wait a bit for opponent if not finished yet
      if (!opponentFinished) {
        Alert.alert(
          'Réponses envoyées',
          "En attente de votre adversaire...",
          [{ text: 'OK' }]
        );

        // Wait max 30 seconds for opponent
        await waitForOpponent(30000);
      }

      setMultiplayerResults(myResults, myScore);
      router.push('/online-results');
    } catch (error) {
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
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

        <View style={styles.submitContainer}>
          <Button
            title="Terminer la partie"
            onPress={handleSubmit}
            loading={submitting}
          />
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
  submitContainer: {
    marginTop: 24,
  },
});