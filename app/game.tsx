import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import InputWord from '../components/InputWord';
import Timer from '../components/Timer';
import Button from '../components/Button';
import { validateWord } from '../services/api';
import { GameResult } from '../store/gameStore';

export default function GameScreen() {
  const router = useRouter();
  const {
    currentLetter,
    categories,
    answers,
    setAnswer,
    setResults,
    setScore,
    endGame,
  } = useGameStore();

  const [submitting, setSubmitting] = useState(false);

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

    try {
      const results: GameResult[] = [];
      let totalScore = 0;

      for (const category of categories) {
        const answer = answers.find((a) => a.categorieId === category.id);
        const word = answer?.word || '';

        if (!word.trim()) {
          results.push({
            categorieId: category.id,
            categorieName: category.nom,
            word: '',
            isValid: false,
            points: 0,
          });
          continue;
        }

        if (!word.toLowerCase().startsWith(currentLetter.toLowerCase())) {
          results.push({
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
        totalScore += points;

        results.push({
          categorieId: category.id,
          categorieName: category.nom,
          word,
          isValid,
          points,
        });
      }

      setResults(results);
      setScore(totalScore);
      router.push('/results');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de valider les réponses');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.letterContainer}>
          <Text style={styles.letterLabel}>Lettre</Text>
          <Text style={styles.letter}>{currentLetter.toUpperCase()}</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  letterContainer: {
    alignItems: 'center',
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
