// app/multiplayer-results.tsx - VERSION COMPLÈTE "PETIT BAC"
import { View, Text, StyleSheet, ScrollView, Alert, Dimensions, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { useSettingsStore } from '../store/settingsStore';
import Button from '../components/Button';
import { bluetoothService, GameMessage } from '../services/bluetooth';
import { GameResult, RoundHistory } from '../store/gameStore';
import { getCategories } from '../services/api';
import { addWordToLocalDictionary } from '../services/offline';
import { CheckCircle, XCircle, Trophy, Crown, Play, StopCircle, Star, Award, Zap, HelpCircle } from 'lucide-react-native';

import { pickRandomLetter } from '../utils/letters';
import { normalizeWord } from '../utils/normalize';
import { computeRoundOutcome } from '../utils/roundScoring';
import { checkWordsBatchClient, isSafeCandidateWord } from '../utils/geminiClient';
import { colors, fonts, radius, spacing, shadow } from '../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SAFE_AREA_HEIGHT = SCREEN_HEIGHT * 0.25;

export default function MultiplayerResultsScreen() {
  const router = useRouter();
  const {
    results,
    opponentResults: storedOpponentResults,
    opponentScore: storedOpponentScore,
    opponentName,
    categories,
    setCategories,
    currentRound,
    roundHistory,
    addRoundToHistory,
    startNewRound,
    resetGame,
    currentLetter,
    isHost,
    stoppedEarly,
    patchOwnResult,
    dictionaryHistory,
    addDictionaryHistoryEntries,
    setDictionaryHistoryResult,
  } = useGameStore();

  const [opponentResults, setOpponentResults] = useState<GameResult[]>(storedOpponentResults || []);
  const [opponentScore, setOpponentScore] = useState(storedOpponentScore || 0);
  const [opponentStoppedEarly, setOpponentStoppedEarly] = useState(false);
  const [loading, setLoading] = useState(!storedOpponentResults);
  const [showFinalResults, setShowFinalResults] = useState(false);
  const [waitingForNextRound, setWaitingForNextRound] = useState(false);
  // Demandes de validation manuelle envoyées, en attente de réponse
  const [pendingValidation, setPendingValidation] = useState<Set<number>>(new Set());

  const resultsReceivedRef = useRef(false);
  // Le gate IA de fin de manche (Partie 7) ne doit tourner qu'une fois par
  // manche même si commitRoundToHistory() est appelée plusieurs fois.
  const dictionaryGateRanRef = useRef(false);
  const opponentReadyRef = useRef(false);
  const iAmReadyRef = useRef(false);
  // La manche n'est ajoutée à l'historique qu'une fois, au moment de passer
  // à la suite : ça laisse le temps aux validations manuelles en cours de
  // corriger le score avant qu'il ne devienne définitif.
  const committedRef = useRef(false);

  useEffect(() => {
    // Écouter les messages de l'adversaire
    const handleOpponentMessage = async (message: GameMessage) => {
      if (message.type === 'ANSWER_SUBMIT' && !resultsReceivedRef.current) {
        resultsReceivedRef.current = true;
        setOpponentResults(message.data.results);
        setOpponentScore(message.data.score || 0);
        setOpponentStoppedEarly(message.data.stoppedEarly || false);
        setLoading(false);
      } else if (message.type === 'NEXT_ROUND') {
        // L'adversaire est prêt pour la manche suivante
        opponentReadyRef.current = true;
        if (iAmReadyRef.current) {
          startNextRound(message.data.letter);
        }
      } else if (message.type === 'FINISH_GAME') {
        // L'adversaire veut arrêter
        commitRoundToHistory();
        setShowFinalResults(true);
      } else if (message.type === 'VALIDATION_REQUEST') {
        // L'adversaire demande qu'on valide SON mot (absent du dictionnaire)
        const { categorieId, categorieName, word } = message.data;
        Alert.alert(
          'Validation demandée',
          `${opponentName} pense que « ${word} » est valide pour la catégorie « ${categorieName} ». Êtes-vous d'accord ?`,
          [
            {
              text: 'Non',
              style: 'cancel',
              onPress: () => {
                bluetoothService
                  .sendMessage({
                    type: 'VALIDATION_RESPONSE',
                    data: { categorieId, word, approved: false },
                  })
                  .catch((e) => console.warn('BLE: réponse de validation non envoyée', e));
              },
            },
            {
              text: 'Oui',
              onPress: async () => {
                // Si j'ai MOI-MÊME écrit exactement le même mot pour cette
                // catégorie (et qu'il n'est pas déjà valide), on valide les
                // deux d'un coup avec des points partagés (1pt chacun au
                // lieu de 2) — plus besoin que je sollicite ma propre
                // demande pour un mot strictement identique (Partie 2).
                const myMatch = liveRef.current.results?.find(
                  (r) => r.categorieId === categorieId && !r.isValid && r.word && normalizeWord(r.word) === normalizeWord(word)
                );
                const alsoMatchesMine = !!myMatch;

                // Envoi D'ABORD : si le BLE échoue, on ne corrige rien
                // localement (sinon nos deux écrans divergeraient).
                try {
                  await bluetoothService.sendMessage({
                    type: 'VALIDATION_RESPONSE',
                    data: { categorieId, word, approved: true, alsoMatchesMine },
                  });
                } catch (e) {
                  console.warn('BLE: réponse de validation non envoyée', e);
                  Alert.alert('Erreur', "Impossible d'envoyer votre accord (connexion Bluetooth perdue ?).");
                  return;
                }
                const sharedPoints = alsoMatchesMine ? 1 : 2;
                setOpponentResults((prev) =>
                  prev.map((r) => (r.categorieId === categorieId ? { ...r, isValid: true, points: sharedPoints } : r))
                );
                if (alsoMatchesMine) {
                  patchOwnResult(categorieId, {
                    isValid: true,
                    points: 1,
                    manualValidationResult: true,
                    needsManualValidation: false,
                  });
                }
                // L'ajout au dictionnaire local n'est plus immédiat : il
                // passe par le gate IA groupé en fin de manche (Partie 7).
              },
            },
          ]
        );
      } else if (message.type === 'VALIDATION_RESPONSE') {
        // Réponse à MA demande de validation
        const { categorieId, word, approved, alsoMatchesMine } = message.data;
        setPendingValidation((prev) => {
          const next = new Set(prev);
          next.delete(categorieId);
          return next;
        });
        if (approved) {
          patchOwnResult(categorieId, {
            isValid: true,
            points: alsoMatchesMine ? 1 : 2,
            manualValidationResult: true,
            needsManualValidation: false,
          });
          // Idem : ajout différé au gate IA de fin de manche (Partie 7).
        } else {
          patchOwnResult(categorieId, { manualValidationResult: false, needsManualValidation: false });
          Alert.alert('Validation refusée', `${opponentName} n'a pas validé « ${word} ».`);
        }
      }
    };

    bluetoothService.setMessageListener(handleOpponentMessage);

    // Si on a déjà les résultats, pas besoin d'attendre
    if (storedOpponentResults && storedOpponentResults.length > 0) {
      setLoading(false);
    }

    return () => {
      // Garder le listener actif
    };
  }, [storedOpponentResults]);

  function requestWordValidation(categorieId: number, categorieName: string, word: string) {
    setPendingValidation((prev) => new Set(prev).add(categorieId));
    bluetoothService
      .sendMessage({
        type: 'VALIDATION_REQUEST',
        data: { categorieId, categorieName, word },
      })
      .catch((e) => {
        // Échec d'envoi (connexion perdue) : ne pas laisser le bouton
        // bloqué sur "En attente..." pour une demande jamais partie.
        console.warn('BLE: demande de validation non envoyée', e);
        setPendingValidation((prev) => {
          const next = new Set(prev);
          next.delete(categorieId);
          return next;
        });
        Alert.alert('Erreur', "Impossible d'envoyer la demande (connexion Bluetooth perdue ?).");
      });
  }

  // Score final de la manche : recalculé des DEUX côtés à partir des mêmes
  // données échangées (résultats + qui a stoppé manuellement), avec partage
  // des mots dupliqués + pénalité de STOP raté + bonus de STOP propre
  // (même règles que le mode en ligne, voir utils/roundScoring.ts).
  const myOutcome = results
    ? computeRoundOutcome({ myResults: results, opponentResults, iStoppedManually: stoppedEarly || false })
    : null;
  const opponentOutcome = computeRoundOutcome({
    myResults: opponentResults,
    opponentResults: results || [],
    iStoppedManually: opponentStoppedEarly,
  });

  const myFinalScore = myOutcome?.score ?? 0;
  const opponentFinalScore = opponentOutcome.score;

  // handleOpponentMessage (ci-dessus) est enregistré UNE SEULE FOIS auprès de
  // bluetoothService et garde donc des closures figées sur le premier rendu :
  // si FINISH_GAME arrive après une validation manuelle qui a corrigé le
  // score, lire `results`/`opponentResults` directement y renverrait les
  // valeurs d'avant correction. Cette ref, réassignée à chaque rendu, permet
  // à commitRoundToHistory() de toujours lire l'état le plus récent même
  // appelée depuis ce handler figé.
  const liveRef = useRef({ results, opponentResults, myFinalScore, opponentFinalScore });
  liveRef.current = { results, opponentResults, myFinalScore, opponentFinalScore };

  // Ajoute la manche courante à l'historique, une seule fois, avec le score
  // (éventuellement corrigé par une validation manuelle) au moment de l'appel.
  function commitRoundToHistory() {
    const live = liveRef.current;
    if (committedRef.current || !live.results || live.opponentResults.length === 0) return;
    committedRef.current = true;
    const roundData: RoundHistory = {
      roundNumber: currentRound,
      letter: currentLetter || '',
      myScore: live.myFinalScore,
      opponentScore: live.opponentFinalScore,
      myValidWords: live.results.filter(r => r.isValid).length,
      opponentValidWords: live.opponentResults.filter(r => r.isValid).length,
    };
    if (!roundHistory.find(r => r.roundNumber === currentRound)) {
      addRoundToHistory(roundData);
    }
    runDictionaryAIGateBLE(live.results);
  }

  // Gate IA de fin de manche (Partie 7, mode Bluetooth) : les mots que J'AI
  // proposés et que l'adversaire a validés par accord mutuel comptent déjà
  // pour le score (ci-dessus) — ici on décide seulement de leur ajout
  // permanent au dictionnaire LOCAL de cet appareil, en un seul appel groupé.
  async function runDictionaryAIGateBLE(myResults: GameResult[]) {
    if (dictionaryGateRanRef.current) return;
    dictionaryGateRanRef.current = true;

    const candidates = myResults.filter((r) => r.manualValidationResult === true && r.word);
    if (candidates.length === 0) return;

    addDictionaryHistoryEntries(candidates.map((r) => ({ word: r.word, categorieName: r.categorieName })));

    const apiKey = useSettingsStore.getState().geminiApiKey;
    if (!apiKey) return; // reste "en attente" : bandeau affiché à l'utilisateur

    try {
      const verdicts = await checkWordsBatchClient(
        apiKey,
        candidates.map((r) => ({
          word: r.word,
          categorieId: r.categorieId,
          categorieName: r.categorieName,
          letter: currentLetter || '',
        }))
      );
      const verdictByKey = new Map(verdicts.map((v) => [`${v.categorieId}:${normalizeWord(v.word)}`, v.valid]));

      for (const r of candidates) {
        const key = `${r.categorieId}:${normalizeWord(r.word)}`;
        const valid = verdictByKey.get(key) === true && isSafeCandidateWord(r.word, currentLetter || '');
        if (valid) {
          await addWordToLocalDictionary(r.word, r.categorieId);
        }
        setDictionaryHistoryResult(r.word, r.categorieName, valid);
      }
    } catch (e) {
      console.warn('Gate IA dictionnaire (BLE) échoué (non bloquant):', e);
      // Les entrées restent en attente (aiResult: null) plutôt que de faire
      // planter l'écran de résultats pour un échec réseau non critique.
    }
  }

  // Totaux cumulés dérivés UNIQUEMENT de l'historique (source unique) : la
  // manche courante n'y est pas encore si elle n'a pas été commitée.
  const histMy = roundHistory.reduce((s, r) => s + r.myScore, 0);
  const histOpponent = roundHistory.reduce((s, r) => s + r.opponentScore, 0);
  const myTotalScore = committedRef.current ? histMy : histMy + myFinalScore;
  const opponentTotal = committedRef.current ? histOpponent : histOpponent + opponentFinalScore;
  const pendingDictionaryCount = dictionaryHistory.filter((w) => w.aiResult === null).length;

  // Générer une nouvelle lettre : jamais celle en cours tant que les 20
  // lettres n'ont pas toutes été jouées (inclusion explicite de
  // currentLetter, indépendante de commitRoundToHistory()).
  const getNewLetter = () => {
    const used = roundHistory.map((r) => r.letter);
    if (currentLetter) used.push(currentLetter);
    return pickRandomLetter(used);
  };

  // Démarrer la manche suivante
  const startNextRound = async (letter?: string) => {
    const newLetter = letter || getNewLetter();
    // BUG CORRIGÉ : on appelait ici startMultiplayerGame(), qui remet
    // currentRound à 1 ET vide roundHistory — le score cumulé perdait donc
    // tout l'historique des manches précédentes à CHAQUE "Manche suivante".
    // startNewRound() seul incrémente la manche sans toucher à l'historique.
    if (categories.length === 0) {
      setCategories(await getCategories());
    }
    startNewRound(newLetter);
    router.replace('/multiplayer-game');
  };

  // Gérer le clic sur "Manche suivante"
  const handleNextRound = async () => {
    commitRoundToHistory();

    try {
      if (!isHost) {
        // Si je ne suis pas l'hôte, j'envoie juste mon ready
        iAmReadyRef.current = true;
        await bluetoothService.sendMessage({
          type: 'NEXT_ROUND',
          data: { ready: true },
        });
        setWaitingForNextRound(true);
        return;
      }

      // Si je suis l'hôte, je génère la nouvelle lettre et l'envoie
      const newLetter = getNewLetter();

      iAmReadyRef.current = true;
      await bluetoothService.sendMessage({
        type: 'NEXT_ROUND',
        data: { letter: newLetter },
      });

      // Attendre un peu que l'adversaire reçoive le message
      setTimeout(() => {
        startNextRound(newLetter);
      }, 500);
    } catch (e) {
      console.warn('BLE: NEXT_ROUND non envoyé', e);
      iAmReadyRef.current = false;
      Alert.alert('Erreur', "Impossible de lancer la manche suivante (connexion Bluetooth perdue ?).");
    }
  };

  // Gérer l'arrêt de la partie
  const handleStopGame = async () => {
    Alert.alert(
      'Arrêter la partie',
      'Voulez-vous vraiment arrêter la partie ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Arrêter',
          style: 'destructive',
          onPress: async () => {
            commitRoundToHistory();
            // Même si l'envoi échoue (connexion perdue), on affiche NOTRE
            // écran final : l'adversaire a son propre bouton Arrêter.
            try {
              await bluetoothService.sendMessage({
                type: 'FINISH_GAME',
                data: {},
              });
            } catch (e) {
              console.warn('BLE: FINISH_GAME non envoyé', e);
            }
            setShowFinalResults(true);
          },
        },
      ]
    );
  };

  // Nouvelle partie
  const handleNewGame = () => {
    bluetoothService.disconnect();
    resetGame();
    router.replace('/');
  };

  if (!results) {
    router.replace('/');
    return null;
  }

  // Affichage des résultats finaux
  if (showFinalResults) {
    const isWinner = myTotalScore > opponentTotal;
    const isDraw = myTotalScore === opponentTotal;

    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.winnerSection}>
            {isDraw ? (
              <>
                <Trophy size={80} color={colors.gold} />
                <Text style={styles.winnerText}>Égalité ! 🤝</Text>
              </>
            ) : isWinner ? (
              <>
                <Crown size={80} color={colors.gold} />
                <Text style={styles.winnerText}>Victoire ! 🎉</Text>
              </>
            ) : (
              <>
                <Trophy size={80} color={colors.textMuted} />
                <Text style={styles.loserText}>Défaite</Text>
                <Text style={styles.winnerName}>{opponentName} gagne !</Text>
              </>
            )}
          </View>

          <View style={styles.finalScoresCard}>
            <View style={styles.cardHeader}>
              <Award size={24} color={colors.primary} />
              <Text style={styles.sectionTitle}>Score final</Text>
            </View>
            
            <View style={styles.finalScoresRow}>
              <View style={[styles.finalScoreBlock, isWinner && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>Vous</Text>
                <Text style={styles.finalScoreValue}>{myTotalScore}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color={colors.gold} />
                  <Text style={styles.validCount}>
                    {roundHistory.reduce((sum, r) => sum + r.myValidWords, 0)} mots valides
                  </Text>
                </View>
              </View>

              <View style={[styles.finalScoreBlock, !isWinner && !isDraw && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>{opponentName}</Text>
                <Text style={styles.finalScoreValue}>{opponentTotal}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color={colors.gold} />
                  <Text style={styles.validCount}>
                    {roundHistory.reduce((sum, r) => sum + r.opponentValidWords, 0)} mots valides
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {dictionaryHistory.length > 0 && (
            <View style={styles.dictionaryHistoryContainer}>
              <Text style={styles.sectionTitle}>Mots ajoutés au dictionnaire</Text>
              {pendingDictionaryCount > 0 && (
                <View style={styles.noKeyBanner}>
                  <Text style={styles.noKeyBannerText}>
                    {pendingDictionaryCount} mot(s) comptent pour votre score mais n'ont pas encore été
                    soumis à l'IA — ajoute une clé Gemini gratuite (aistudio.google.com) dans les
                    réglages pour activer l'ajout automatique au dictionnaire.
                  </Text>
                </View>
              )}
              {dictionaryHistory.map((w, index) => (
                <View key={index} style={styles.dictionaryHistoryRow}>
                  <Text style={styles.dictionaryHistoryIcon}>
                    {w.aiResult === null ? '⏳' : w.aiResult ? '✅' : '❌'}
                  </Text>
                  <Text style={styles.dictionaryHistoryText}>
                    {w.word} — {w.categorieName}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.historyContainer}>
            <Text style={styles.sectionTitle}>Historique ({roundHistory.length} manches)</Text>
            {roundHistory.map((round, index) => (
              <View key={index} style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyRound}>Manche {round.roundNumber}</Text>
                  <View style={styles.letterBadge}>
                    <Text style={styles.letterText}>{round.letter}</Text>
                  </View>
                </View>
                <View style={styles.historyScores}>
                  <Text style={styles.historyScore}>Vous: {round.myScore}pts</Text>
                  <Text style={styles.historyScore}>{opponentName}: {round.opponentScore}pts</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.buttonContainer}>
            <Button title="Nouvelle partie" onPress={handleNewGame} />
          </View>
        </ScrollView>
      </View>
    );
  }

  // Écran d'attente pour la manche suivante
  if (waitingForNextRound) {
    return (
      <View style={styles.container}>
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingTitle}>En attente de l'hôte...</Text>
          <Text style={styles.waitingText}>
            {opponentName} prépare la prochaine manche
          </Text>
        </View>
      </View>
    );
  }

  // Affichage des résultats de la manche
  const isWinner = myFinalScore > opponentFinalScore;
  const isDraw = myFinalScore === opponentFinalScore;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.roundHeader}>
          <Text style={styles.roundTitle}>Manche {currentRound}</Text>
          <View style={styles.letterBadge}>
            <Text style={styles.letterText}>{currentLetter}</Text>
          </View>
        </View>

        <View style={styles.scoreCard}>
          <View style={styles.scoreHeader}>
            <Zap size={24} color={colors.gold} />
            <Text style={styles.scoreLabel}>Score de la manche</Text>
          </View>
          
          <View style={styles.scoresRow}>
            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>Vous</Text>
              <Text style={styles.scoreValue}>{myFinalScore}</Text>
              <View style={styles.statsRow}>
                <CheckCircle size={16} color={colors.success} />
                <Text style={styles.validCount}>{results.filter(r => r.isValid).length} valides</Text>
              </View>
              {myOutcome?.penaltyApplied && (
                <Text style={styles.penaltyText}>⚠️ -3pts (pénalité)</Text>
              )}
              {myOutcome?.bonusApplied && (
                <Text style={styles.bonusText}>⭐ +3pts (STOP parfait)</Text>
              )}
            </View>

            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>{opponentName}</Text>
              <Text style={styles.scoreValue}>
                {loading ? '...' : opponentFinalScore}
              </Text>
              {!loading && (
                <>
                  <View style={styles.statsRow}>
                    <CheckCircle size={16} color={colors.success} />
                    <Text style={styles.validCount}>
                      {opponentResults.filter(r => r.isValid).length} valides
                    </Text>
                  </View>
                  {opponentOutcome.penaltyApplied && (
                    <Text style={styles.penaltyText}>⚠️ -3pts (pénalité)</Text>
                  )}
                  {opponentOutcome.bonusApplied && (
                    <Text style={styles.bonusText}>⭐ +3pts (STOP parfait)</Text>
                  )}
                </>
              )}
            </View>
          </View>
        </View>

        <View style={styles.totalScoreCard}>
          <Text style={styles.totalScoreLabel}>Score total</Text>
          <View style={styles.totalScoreRow}>
            <Text style={styles.totalScoreValue}>{myTotalScore}</Text>
            <Text style={styles.totalScoreSeparator}>-</Text>
            <Text style={styles.totalScoreValue}>{opponentTotal}</Text>
          </View>
        </View>

        {!loading && opponentResults.length > 0 && (
          <View style={styles.comparisonContainer}>
            <Text style={styles.sectionTitle}>Réponses</Text>
            {results.map((result, index) => {
              const opponentResult = opponentResults[index];
              // Points affichés = version ajustée (partage si mot dupliqué),
              // pas les points bruts stockés dans le store.
              const displayPoints =
                myOutcome?.results.find((r) => r.categorieId === result.categorieId)?.points ?? result.points;
              const opponentDisplayPoints = opponentResult
                ? opponentOutcome.results.find((r) => r.categorieId === opponentResult.categorieId)?.points ??
                  opponentResult.points
                : 0;
              return (
                <View key={index} style={styles.comparisonCard}>
                  <Text style={styles.categoryName}>{result.categorieName}</Text>
                  <View style={styles.comparisonRow}>
                    <View style={styles.answerBlock}>
                      {result.word ? (
                        <View style={styles.answerContainer}>
                          <Text style={styles.answerWord}>{result.word}</Text>
                          {result.isValid ? (
                            <CheckCircle size={20} color={colors.success} />
                          ) : (
                            <XCircle size={20} color={colors.danger} />
                          )}
                          <Text style={styles.pointsText}>+{displayPoints}</Text>
                        </View>
                      ) : (
                        <Text style={styles.noAnswer}>-</Text>
                      )}
                      {result.word && !result.isValid && (
                        pendingValidation.has(result.categorieId) ? (
                          <Text style={styles.validationPending}>En attente...</Text>
                        ) : (
                          <TouchableOpacity
                            style={styles.validationButton}
                            onPress={() =>
                              requestWordValidation(result.categorieId, result.categorieName, result.word)
                            }
                          >
                            <HelpCircle size={13} color={colors.primary} />
                            <Text style={styles.validationButtonText}>
                              {result.manualValidationResult === false ? 'Redemander' : 'Demander validation'}
                            </Text>
                          </TouchableOpacity>
                        )
                      )}
                    </View>

                    <View style={styles.answerBlock}>
                      {opponentResult?.word ? (
                        <View style={styles.answerContainer}>
                          <Text style={styles.answerWord}>{opponentResult.word}</Text>
                          {opponentResult.isValid ? (
                            <CheckCircle size={20} color={colors.success} />
                          ) : (
                            <XCircle size={20} color={colors.danger} />
                          )}
                          <Text style={styles.pointsText}>+{opponentDisplayPoints}</Text>
                        </View>
                      ) : (
                        <Text style={styles.noAnswer}>-</Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.buttonContainer}>
          <Button
            title="Manche suivante"
            onPress={handleNextRound}
            icon={<Play size={20} color={colors.onPrimary} />}
          />
          <Button
            title="Arrêter la partie"
            onPress={handleStopGame}
            variant="secondary"
            icon={<StopCircle size={20} color={colors.primary} />}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: SAFE_AREA_HEIGHT,
  },
  roundHeader: {
    alignItems: 'center',
    marginBottom: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  roundTitle: {
    fontSize: 30,
    fontFamily: fonts.display,
    color: colors.text,
  },
  letterBadge: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.goldSoft,
    borderWidth: 2,
    borderColor: colors.goldBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  letterText: {
    fontSize: 24,
    fontFamily: fonts.displayBold,
    color: colors.goldDeep,
  },
  scoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 24,
    marginBottom: 16,
    ...shadow.card,
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
    fontWeight: '700',
    color: colors.text,
  },
  scoresRow: {
    flexDirection: 'row',
    gap: 16,
  },
  scoreBlock: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: 16,
  },
  playerLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
    fontWeight: '600',
  },
  scoreValue: {
    fontSize: 48,
    fontFamily: fonts.displayBold,
    color: colors.primary,
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  validCount: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  penaltyText: {
    fontSize: 12,
    color: colors.danger,
    marginTop: 6,
    fontWeight: '700',
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  bonusText: {
    fontSize: 12,
    color: colors.success,
    marginTop: 6,
    fontWeight: '700',
    backgroundColor: colors.successSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  totalScoreCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 24,
    alignItems: 'center',
  },
  totalScoreLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
    fontWeight: '600',
  },
  totalScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  totalScoreValue: {
    fontSize: 32,
    fontFamily: fonts.displayBold,
    color: colors.primary,
  },
  totalScoreSeparator: {
    fontSize: 24,
    color: colors.textMuted,
  },
  comparisonContainer: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: fonts.display,
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  comparisonCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    ...shadow.card,
  },
  categoryName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 12,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  comparisonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  answerBlock: {
    flex: 1,
  },
  validationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primarySoft,
  },
  validationButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  validationPending: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  answerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bg,
    padding: 8,
    borderRadius: 8,
  },
  answerWord: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
  },
  noAnswer: {
    fontSize: 16,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  pointsText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.success,
    backgroundColor: colors.successSoft,
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
  },
  winnerText: {
    fontSize: 34,
    fontFamily: fonts.displayBold,
    color: colors.success,
    marginTop: 20,
  },
  loserText: {
    fontSize: 30,
    fontFamily: fonts.display,
    color: colors.textSecondary,
    marginTop: 16,
  },
  winnerName: {
    fontSize: 20,
    color: colors.primary,
    marginTop: 8,
    fontWeight: '600',
  },
  finalScoresCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 24,
    marginBottom: 24,
    ...shadow.card,
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
    gap: 16,
  },
  finalScoreBlock: {
    flex: 1,
    alignItems: 'center',
    padding: 20,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  winnerBlock: {
    backgroundColor: colors.successSoft,
    borderWidth: 2,
    borderColor: colors.success,
  },
  finalScoreValue: {
    fontSize: 52,
    fontFamily: fonts.displayBold,
    color: colors.primary,
    marginBottom: 8,
  },
  dictionaryHistoryContainer: { marginBottom: 24 },
  noKeyBanner: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    padding: 12,
    marginBottom: 12,
  },
  noKeyBannerText: {
    fontSize: 12,
    color: colors.goldDeep,
    lineHeight: 17,
  },
  dictionaryHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: 10,
    marginBottom: 6,
  },
  dictionaryHistoryIcon: { fontSize: 14 },
  dictionaryHistoryText: { fontSize: 13, color: colors.text, flex: 1 },
  historyContainer: {
    marginBottom: 24,
  },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    ...shadow.card,
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
    color: colors.text,
  },
  historyScores: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  historyScore: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  waitingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  waitingTitle: {
    fontSize: 26,
    fontFamily: fonts.display,
    color: colors.text,
    marginTop: 24,
    textAlign: 'center',
  },
  waitingText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 12,
    textAlign: 'center',
  },
});