//app/results.tsx
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useGameStore } from '../store/gameStore';
import Button from '../components/Button';
import { CheckCircle, XCircle, Trophy } from 'lucide-react-native';

export default function ResultsScreen() {
  const router = useRouter();
  const { results, score, resetGame } = useGameStore();

  if (!results) {
    router.replace('/');
    return null;
  }

  const validAnswers = results.filter((r) => r.isValid).length;
  const totalAnswers = results.filter((r) => r.word.trim() !== '').length;

  function handlePlayAgain() {
    resetGame();
    router.replace('/');
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Trophy size={64} color="#FFD700" />
          <Text style={styles.title}>Résultats</Text>
          <View style={styles.scoreContainer}>
            <Text style={styles.scoreLabel}>Score</Text>
            <Text style={styles.score}>{score} points</Text>
          </View>
          <Text style={styles.stats}>
            {validAnswers} / {totalAnswers} réponses valides
          </Text>
        </View>

        <View style={styles.resultsContainer}>
          {results.map((result, index) => (
            <View key={index} style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <Text style={styles.category}>{result.categorieName}</Text>
                {result.isValid ? (
                  <CheckCircle size={24} color="#4caf50" />
                ) : (
                  <XCircle size={24} color="#f44336" />
                )}
              </View>

              {result.word ? (
                <View style={styles.answerContainer}>
                  <Text style={styles.word}>{result.word}</Text>
                  <Text
                    style={[
                      styles.points,
                      result.isValid ? styles.validPoints : styles.invalidPoints,
                    ]}
                  >
                    {result.points} pts
                  </Text>
                </View>
              ) : (
                <Text style={styles.noAnswer}>Pas de réponse</Text>
              )}
            </View>
          ))}
        </View>

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
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#333',
    marginTop: 16,
    marginBottom: 20,
  },
  scoreContainer: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    marginBottom: 12,
  },
  scoreLabel: {
    fontSize: 14,
    color: '#fff',
    textAlign: 'center',
    opacity: 0.9,
  },
  score: {
    fontSize: 42,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  stats: {
    fontSize: 16,
    color: '#666',
  },
  resultsContainer: {
    gap: 12,
    marginBottom: 32,
  },
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  category: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  answerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  word: {
    fontSize: 18,
    color: '#666',
    fontWeight: '500',
  },
  points: {
    fontSize: 16,
    fontWeight: '600',
  },
  validPoints: {
    color: '#4caf50',
  },
  invalidPoints: {
    color: '#f44336',
  },
  noAnswer: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  buttonContainer: {
    marginTop: 8,
  },
});
