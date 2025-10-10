// app/multiplayer-game.tsx
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import InputWord from '../components/InputWord';
import Timer from '../components/Timer';
import Button from '../components/Button';
import { validateWord } from '../services/api';
import { bluetoothService, GameMessage } from '../services/bluetooth';
import { GameResult } from '../store/gameStore';

export default function MultiplayerGameScreen() {
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
    // Listen for opponent messages
    bluetoothService.setMessageListener(handleOpponentMessage);

    return () => {
      bluetoothService.setMessageListener(() => {});
    };
  }, [answers]);

  if (!currentLetter || categories.length === 0) {
    router.replace('/');
    return null;
  }

  function handleOpponentMessage(message: GameMessage) {
    if (message.type === 'ANSWER_SUBMIT') {
      setOpponentFinished(true);
    }
  }

  async function handleTimeUp() {
    await handleSubmit();
  }

  async function handleSubmit() {
    setSubmitting(true);
    endGame();

    try {
      // Validate player's answers
      const myResults: GameResult[] = [];
      let myScore = 0;

      for (const category of categories) {
        const answer = answers.find((a) => a.categorieId === category.id);
        const word = answer?.word || '';

        if (!word.trim()) {
          myResults.push({
            categorieId: category.id,
            categorieName: category.nom,
            word: '',
            isValid: false,
            points: 0,
          });
          continue;
        }

        if (!word.toLowerCase().startsWith(currentLetter.toLowerCase())) {
          myResults.push({
            categorieId: category.id,
            categorieName: category.nom,
            word,
            isValid: false,
            points: 0,
          });
          continue;
        }

        const isValid = await validateWord(word, category.id);
        const points = isValid ? 10 : 0;
        myScore += points;

        myResults.push({
          categorieId: category.id,
          categorieName: category.nom,
          word,
          isValid,
          points,
        });
      }

      // Send results to opponent
      await bluetoothService.sendMessage({
        type: 'ANSWER_SUBMIT',
        data: {
          results: myResults,
          score: myScore,
        },
      });

      // Wait for opponent if not finished yet
      if (!opponentFinished) {
        Alert.alert(
          'Réponses envoyées',
          "En attente de votre adversaire...",
          [{ text: 'OK' }]
        );

        // Wait for opponent response
        await waitForOpponent();
      }

      setMultiplayerResults(myResults, myScore);
      router.push('/multiplayer-results');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de valider les réponses');
    } finally {
      setSubmitting(false);
    }
  }

  function waitForOpponent(): Promise<void> {
    return new Promise((resolve) => {
      bluetoothService.setMessageListener((message) => {
        if (message.type === 'ANSWER_SUBMIT') {
          resolve();
        }
      });
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