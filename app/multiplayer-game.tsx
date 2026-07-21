// app/multiplayer-game.tsx - VERSION COMPLÈTE "PETIT BAC"
import { View, Text, StyleSheet, ScrollView, Alert, Dimensions, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import InputWord from '../components/InputWord';
import Timer from '../components/Timer';
import Button from '../components/Button';
import { validateWord } from '../services/api';
import { bluetoothService, GameMessage } from '../services/bluetooth';
import { GameResult } from '../store/gameStore';
import { startsWithLetter } from '../utils/normalize';
import { pickRandomLetter } from '../utils/letters';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, gradients, radius, spacing, shadow } from '../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SAFE_AREA_HEIGHT = SCREEN_HEIGHT * 0.25;

export default function MultiplayerGameScreen() {
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);
  const {
    currentLetter,
    categories,
    answers,
    setAnswer,
    setMultiplayerResults,
    setOpponentResults,
    endGame,
    opponentName,
    currentRound,
    roundHistory,
    startNewRound,
    startMultiplayerGame,
    isHost,
    setEndGameRequestReceived,
  } = useGameStore();

  const [submitting, setSubmitting] = useState(false);
  const [opponentFinished, setOpponentFinished] = useState(false);
  const [iStoppedEarly, setIStoppedEarly] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  
  // Refs pour la synchronisation
  const opponentResultsRef = useRef<GameResult[] | null>(null);
  const opponentScoreRef = useRef(0);
  const opponentStoppedEarlyRef = useRef(false);
  const hasSubmittedRef = useRef(false);
  const resolveOpponentRef = useRef<(() => void) | null>(null);
  const isProcessingEndGame = useRef(false);

  // Gestion du clavier
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, []);

  // Générer une nouvelle lettre qui n'a pas été utilisée
  const getNewLetter = useCallback(() => {
    return pickRandomLetter(roundHistory.map(r => r.letter));
  }, [roundHistory]);

  // Fonction pour valider les réponses et calculer le score
  const validateAnswers = useCallback(async (stoppedEarly: boolean) => {
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
        if (currentLetter && startsWithLetter(word, currentLetter)) {
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
    }

    // Appliquer la pénalité si le joueur a validé avec des erreurs
    // Pénalité : -3 points si on a arrêté le jeu ET qu'on a des erreurs
    let penaltyApplied = false;
    if (stoppedEarly && allFieldsFilled && hasInvalidWord) {
      const penalty = 3;
      myScore = Math.max(0, myScore - penalty);
      penaltyApplied = true;
    }

    return { results: myResults, score: myScore, penaltyApplied, hasInvalidWord };
  }, [answers, categories, currentLetter]);

  // Gestion des messages Bluetooth
  useEffect(() => {
    const handleOpponentMessage = async (message: GameMessage) => {
      if (message.type === 'STOP_GAME') {
        // L'adversaire a arrêté le jeu - on doit s'arrêter immédiatement
        setEndGameRequestReceived(true);
        endGame();
        setOpponentFinished(true);
        
        if (!hasSubmittedRef.current) {
          hasSubmittedRef.current = true;
          // Je n'ai pas arrêté le jeu, donc pas de pénalité pour moi
          setIStoppedEarly(false);
          await submitMyResults(false);
        }
      } else if (message.type === 'ANSWER_SUBMIT') {
        // L'adversaire a soumis ses résultats
        if (message.data?.results) {
          opponentResultsRef.current = message.data.results;
          opponentScoreRef.current = message.data.score || 0;
          opponentStoppedEarlyRef.current = message.data.stoppedEarly || false;
          
          // Résoudre l'attente si on attendait
          if (resolveOpponentRef.current) {
            resolveOpponentRef.current();
            resolveOpponentRef.current = null;
          }
        }
      } else if (message.type === 'GAME_START') {
        // Nouvelle manche demandée par l'hôte
        if (message.data?.letter && message.data?.categories) {
          startNewRound(message.data.letter);
          router.replace('/multiplayer-game');
        }
      } else if (message.type === 'FINISH_GAME') {
        // L'adversaire veut arrêter définitivement la partie
        router.push('/multiplayer-results');
      }
    };

    bluetoothService.setMessageListener(handleOpponentMessage);

    return () => {
      // Ne pas supprimer le listener pour garder la communication
    };
  }, [endGame, setEndGameRequestReceived, startNewRound, router]);

  // Soumettre mes résultats
  const submitMyResults = useCallback(async (stoppedEarly: boolean) => {
    if (isProcessingEndGame.current) return;
    isProcessingEndGame.current = true;
    
    setSubmitting(true);
    setIStoppedEarly(stoppedEarly);

    try {
      const { results: myResults, score: myScore, penaltyApplied } = await validateAnswers(stoppedEarly);

      // Envoyer les résultats à l'adversaire
      await bluetoothService.sendMessage({
        type: 'ANSWER_SUBMIT',
        data: {
          results: myResults,
          score: myScore,
          stoppedEarly,
          penaltyApplied,
        },
      });

      // Sauvegarder mes résultats
      setMultiplayerResults(myResults, myScore, stoppedEarly);

      // Attendre les résultats de l'adversaire
      await waitForOpponentResults();

      // Naviguer vers les résultats
      router.push('/multiplayer-results');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de valider les réponses');
    } finally {
      setSubmitting(false);
      isProcessingEndGame.current = false;
    }
  }, [validateAnswers, setMultiplayerResults, router]);

  // Attendre les résultats de l'adversaire
  const waitForOpponentResults = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (opponentResultsRef.current) {
        resolve();
        return;
      }
      
      resolveOpponentRef.current = resolve;
      
      // Timeout après 30 secondes
      setTimeout(() => {
        resolveOpponentRef.current = null;
        resolve();
      }, 30000);
    });
  }, []);

  if (!currentLetter || categories.length === 0) {
    router.replace('/');
    return null;
  }

  // Le temps est écoulé naturellement
  async function handleTimeUp() {
    if (hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;

    endGame();

    // Envoyer STOP_GAME pour arrêter l'adversaire. Si l'envoi échoue
    // (connexion perdue), on valide quand même localement : l'adversaire a
    // son propre timer et s'arrêtera de son côté.
    try {
      await bluetoothService.sendMessage({
        type: 'STOP_GAME',
        data: { reason: 'time_up' },
      });
    } catch (e) {
      console.warn('BLE: STOP_GAME non envoyé', e);
    }

    // Pas de pénalité car c'est le temps qui a expiré
    await submitMyResults(false);
  }

  // Le joueur clique sur "Terminer" manuellement
  async function handleSubmit() {
    if (hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;
    
    // Vérifier si tous les champs sont remplis
    const allFieldsFilled = answers.length === categories.length && 
                            answers.every(a => a.word.trim() !== '');
    
    if (!allFieldsFilled) {
      Alert.alert(
        'Attention',
        'Vous n\'avez pas rempli tous les champs. Voulez-vous quand même terminer ?',
        [
          { text: 'Annuler', style: 'cancel', onPress: () => { hasSubmittedRef.current = false; } },
          { 
            text: 'Terminer', 
            onPress: () => processSubmit(true)
          },
        ]
      );
    } else {
      await processSubmit(true);
    }
  }

  async function processSubmit(stoppedEarly: boolean) {
    setSubmitting(true);
    endGame();

    // Envoyer STOP_GAME pour arrêter l'adversaire immédiatement. En cas
    // d'échec d'envoi, on continue : mieux vaut montrer nos résultats locaux
    // que de bloquer l'écran.
    try {
      await bluetoothService.sendMessage({
        type: 'STOP_GAME',
        data: { reason: 'player_submit' },
      });
    } catch (e) {
      console.warn('BLE: STOP_GAME non envoyé', e);
    }

    await submitMyResults(stoppedEarly);
  }

  // Vérifier si tous les champs sont remplis
  const allFieldsFilled = answers.length === categories.length && 
                          answers.every(a => a.word.trim() !== '');
  const filledCount = answers.filter(a => a.word.trim() !== '').length;
  const progressPercent = categories.length > 0 ? (filledCount / categories.length) * 100 : 0;

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.roundBadge}>
              <Text style={styles.roundLabel}>Manche {currentRound}</Text>
            </View>
            <View style={styles.opponentBadge}>
              <Text style={styles.opponentLabel}>VS {opponentName}</Text>
            </View>
          </View>

          <View style={styles.letterContainer}>
            <Text style={styles.letterLabel}>Lettre</Text>
            <View style={styles.letterCircle}>
              <Text style={styles.letter}>{currentLetter.toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <LinearGradient
                colors={gradients.timer}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.progressFill, { width: `${progressPercent}%` }]}
              />
            </View>
            <Text style={styles.progressText}>
              {filledCount}/{categories.length} catégories
            </Text>
          </View>

          <Timer onTimeUp={handleTimeUp} />

          {opponentFinished && (
            <View style={styles.opponentFinishedNotice}>
              <Text style={styles.opponentFinishedText}>
                ⚡ {opponentName} a terminé ! Validation en cours...
              </Text>
            </View>
          )}
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            keyboardVisible && styles.scrollContentKeyboardVisible
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {categories.map((category, index) => {
            const answer = answers.find((a) => a.categorieId === category.id);
            return (
              <InputWord
                key={category.id}
                index={index}
                category={category.nom}
                value={answer?.word || ''}
                onChangeText={(text) => setAnswer(category.id, text)}
                letter={currentLetter}
              />
            );
          })}

          <View style={styles.actionsContainer}>
            <Button
              title={submitting ? "Validation..." : "Valider mes réponses"}
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            />

            {!allFieldsFilled && (
              <View style={styles.hintBox}>
                <Text style={styles.hintText}>
                  💡 Remplissez toutes les catégories pour éviter la pénalité de validation
                </Text>
              </View>
            )}

            {allFieldsFilled && (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>
                  ⚠️ Attention : Si vous validez avec des mots invalides, vous recevrez une pénalité de 3 points
                </Text>
              </View>
            )}
          </View>
          
          {/* Espace supplémentaire pour le clavier */}
          <View style={styles.keyboardSpacer} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // En-tête posé sur le fond, sans carte (cohérent avec game.tsx / online-game.tsx)
  header: {
    backgroundColor: colors.bg,
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  roundBadge: {
    backgroundColor: colors.goldSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  roundLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.goldDeep,
  },
  opponentBadge: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  opponentLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  letterContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  letterLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
    fontWeight: '600',
  },
  letterCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow.card,
  },
  letter: {
    fontSize: 32,
    fontFamily: fonts.displayBold,
    color: colors.primary,
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBar: {
    height: 7,
    backgroundColor: colors.bgDeep,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    fontWeight: '600',
  },
  opponentFinishedNotice: {
    backgroundColor: colors.warningSoft,
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  opponentFinishedText: {
    color: colors.goldDeep,
    fontWeight: '600',
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: SAFE_AREA_HEIGHT,
  },
  scrollContentKeyboardVisible: {
    paddingBottom: 350, // Espace pour le clavier
  },
  actionsContainer: {
    marginTop: 24,
    gap: 12,
  },
  hintBox: {
    backgroundColor: colors.primarySoft,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  hintText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  warningBox: {
    backgroundColor: colors.warningSoft,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  warningText: {
    color: colors.goldDeep,
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
  keyboardSpacer: {
    height: 250, // Espace supplémentaire pour scroller sous le clavier
  },
});
