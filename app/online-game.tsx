// app/online-game.tsx - GAMEPLAY TEMPS RÉEL (socket.io) avec STOP simultané
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import InputWord from '../components/InputWord';
import Timer from '../components/Timer';
import Button from '../components/Button';
import { validateWord } from '../services/api';
import { websocketService, RoundAnswerResult } from '../services/websocket';
import { Send, Zap, Users, Trophy, AlertCircle } from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  SlideInRight,
  BounceIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withRepeat,
  withTiming,
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
    opponentName,
    currentRound,
  } = useGameStore();

  const [submitting, setSubmitting] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [stoppedByName, setStoppedByName] = useState<string | null>(null);
  const [stoppedReason, setStoppedReason] = useState<string | null>(null);
  const [opponentLeft, setOpponentLeft] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // Garde-fous (refs pour éviter les stale closures dans les callbacks socket)
  const finishedRef = useRef(false);   // j'ai déjà déclenché/reçu le STOP
  const submittedRef = useRef(false);  // j'ai déjà soumis mon score
  const navigatedRef = useRef(false);  // j'ai déjà navigué vers les résultats
  const stopFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const roomId = websocketService.getCurrentRoomId();
  const playerId = websocketService.getCurrentPlayerId();

  // Valide mes réponses localement, calcule le score (avec pénalité) et soumet
  const validateAndSubmit = useCallback(async (stoppedEarly: boolean) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);

    const state = useGameStore.getState();
    const cats = state.categories;
    const ans = state.answers;
    const letter = state.currentLetter;

    let myScore = 0;
    let hasInvalidWord = false;
    const allFieldsFilled =
      ans.length === cats.length && ans.every((a) => a.word.trim() !== '');

    // Validations en PARALLÈLE : en séquentiel, 8 catégories × latence réseau
    // pouvaient dépasser le timeout serveur de collecte des scores.
    const myResults: RoundAnswerResult[] = await Promise.all(
      cats.map(async (category) => {
        const answer = ans.find((a) => a.categorieId === category.id);
        const word = answer?.word?.trim() || '';
        let isValid = false;
        let points = 0;

        if (word) {
          if (letter && word.toLowerCase().startsWith(letter.toLowerCase())) {
            try {
              isValid = await validateWord(word, category.id);
            } catch (error) {
              console.error('Validation error:', error);
            }
            if (isValid) {
              points = 2;
            } else {
              hasInvalidWord = true;
            }
          } else {
            hasInvalidWord = true;
          }
        }

        return {
          categorieId: category.id,
          categorieName: category.nom,
          word,
          isValid,
          points,
        };
      })
    );

    myScore = myResults.reduce((sum, r) => sum + r.points, 0);

    // Pénalité -3 si on a crié STOP avec tous les champs remplis mais des erreurs
    const penalize = stoppedEarly && allFieldsFilled && hasInvalidWord;
    if (penalize) {
      myScore = Math.max(0, myScore - 3);
    }

    const validWordsCount = myResults.filter((r) => r.isValid).length;
    const finalStoppedEarly = stoppedEarly && allFieldsFilled;

    // Sauvegarde locale (sera écrasée par la version serveur dans all-scores-ready)
    state.setMultiplayerResults(myResults, myScore, finalStoppedEarly);

    // Envoi au serveur temps réel
    websocketService.submitScore(myScore, validWordsCount, finalStoppedEarly, myResults);

    // Filet : si 'all-scores-ready' n'arrive jamais (serveur injoignable),
    // on affiche au moins nos résultats locaux au lieu de bloquer l'écran.
    if (resultsFallbackRef.current) clearTimeout(resultsFallbackRef.current);
    resultsFallbackRef.current = setTimeout(() => {
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        console.warn('⚠️ all-scores-ready jamais reçu → résultats locaux');
        router.replace('/online-results');
      }
    }, 25000);
  }, [router]);

  // Déclenche le STOP : on prévient le serveur, qui diffusera 'round-stopped' à TOUS
  const triggerStop = useCallback((reason: 'manual' | 'timeout') => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    useGameStore.getState().endGame(); // fige le timer immédiatement côté local
    websocketService.notifyFinished(reason);

    // Filet : si 'round-stopped' ne revient pas (paquet perdu, coupure),
    // on valide quand même nos réponses après 4s au lieu de rester bloqué.
    stopFallbackRef.current = setTimeout(() => {
      if (!submittedRef.current) {
        console.warn('⚠️ round-stopped jamais reçu → validation locale');
        setStopped(true);
        validateAndSubmit(reason === 'manual');
      }
    }, 4000);
  }, [validateAndSubmit]);

  const handleTimeUp = useCallback(() => triggerStop('timeout'), [triggerStop]);

  // Redirection hors du rendu (un router.replace pendant le render est un
  // effet de bord interdit par React)
  const shouldRedirect = !roomId || !playerId || !currentLetter || categories.length === 0;
  useEffect(() => {
    if (shouldRedirect) {
      router.replace('/');
    }
  }, [shouldRedirect, router]);

  useEffect(() => {
    if (shouldRedirect) return;

    pulseAnim.value = withRepeat(
      withSequence(withSpring(1.1, { damping: 2 }), withSpring(1, { damping: 2 })),
      -1,
      true
    );

    // Repartir d'un état propre : les callbacks d'écrans démontés ne doivent
    // plus réagir aux événements de cette manche.
    websocketService.clearCallbacks();
    websocketService.setCallbacks({
      // (Re)synchronise lettre + horloge si game-started/new-round arrive après
      // le montage (catch-up serveur). elapsed est calculé en temps serveur :
      // l'invité qui arrive 3s après l'hôte démarre son timer à 117s, pas 120s.
      onGameStarted: (data) => {
        const s = useGameStore.getState();
        if (data.letter) s.setLetter(data.letter);
        if (data.roundNumber) useGameStore.setState({ currentRound: data.roundNumber });
        const elapsedSec = data.startedAt
          ? Math.max(0, (data.timestamp - data.startedAt) / 1000)
          : 0;
        s.syncRoundClock(data.roundDuration || 120, elapsedSec);
      },

      // *** STOP SIMULTANÉ *** — reçu par TOUS les joueurs en même temps
      onRoundStopped: (data) => {
        if (stopFallbackRef.current) {
          clearTimeout(stopFallbackRef.current);
          stopFallbackRef.current = null;
        }
        if (submittedRef.current) return;
        finishedRef.current = true;
        setStopped(true);
        setStoppedByName(data.stoppedByName);
        setStoppedReason(data.reason);

        useGameStore.getState().endGame(); // stoppe le timer instantanément

        // shake visuel
        shakeAnim.value = withSequence(
          withTiming(10, { duration: 80 }),
          withTiming(-10, { duration: 80 }),
          withTiming(10, { duration: 80 }),
          withTiming(0, { duration: 80 })
        );

        // Je n'ai de pénalité que si c'est MOI qui ai stoppé manuellement
        const stoppedEarly = data.stoppedBy === playerId && data.reason === 'manual';
        validateAndSubmit(stoppedEarly);
      },

      // Les deux scores sont prêts → on part aux résultats (source de vérité serveur)
      onAllScoresReady: (data) => {
        if (resultsFallbackRef.current) {
          clearTimeout(resultsFallbackRef.current);
          resultsFallbackRef.current = null;
        }
        if (navigatedRef.current) return;
        navigatedRef.current = true;

        const s = useGameStore.getState();
        const me = data.results.find((r) => r.playerId === playerId);
        const opp = data.results.find((r) => r.playerId !== playerId);

        if (me) {
          s.setMultiplayerResults(me.results || [], me.roundScore || 0, me.stoppedEarly || false);
        }
        s.setOpponentResults(opp?.results || [], opp?.roundScore || 0);

        router.replace('/online-results');
      },

      // L'hôte est parti et le serveur m'a promu : sans ça, plus personne
      // ne peut lancer la manche suivante.
      onHostChanged: (data) => {
        if (data.newHostId === playerId) {
          useGameStore.getState().setIsHost(true);
        }
      },

      onPlayerDisconnected: () => {
        // L'adversaire a perdu la connexion : on prévient sans bloquer le joueur,
        // qui peut toujours crier STOP (le serveur finalisera la manche).
        setOpponentLeft(true);
      },
      onPlayerJoined: () => {
        // L'adversaire est revenu
        setOpponentLeft(false);
      },
      onPlayerLeft: () => {
        setOpponentLeft(true);
      },

      // Ma propre connexion : socket.io rejoint automatiquement la room au
      // retour (join-room + catch-up serveur resynchronisent la manche).
      onDisconnected: () => setReconnecting(true),
      onConnected: () => setReconnecting(false),
    });

    return () => {
      // On garde la connexion vivante pour l'écran de résultats / manches
      // suivantes, mais on nettoie nos timers locaux.
      if (stopFallbackRef.current) clearTimeout(stopFallbackRef.current);
      if (resultsFallbackRef.current) clearTimeout(resultsFallbackRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hooks toujours appelés AVANT le return conditionnel (règles des hooks)
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulseAnim.value }] }));
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeAnim.value }] }));

  if (shouldRedirect) {
    return null;
  }

  const allFieldsFilled =
    answers.length === categories.length && answers.every((a) => a.word.trim() !== '');
  const filledCount = answers.filter((a) => a.word.trim() !== '').length;
  const progressPercent = categories.length > 0 ? (filledCount / categories.length) * 100 : 0;

  const busy = stopped || submitting;

  return (
    <View style={styles.container}>
      <Animated.View entering={FadeIn.duration(600)} style={styles.backgroundGradient} />

      <Animated.View entering={SlideInRight.springify()} style={styles.header}>
        <View style={styles.headerTop}>
          <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.roundBadge}>
            <Trophy size={16} color="#FFD700" />
            <Text style={styles.roundLabel}>Manche {currentRound}</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.opponentBadge}>
            <Users size={16} color="#007AFF" />
            <Text style={styles.opponentName}>{opponentName}</Text>
          </Animated.View>
        </View>

        <View style={styles.letterTimerRow}>
          <Animated.View entering={BounceIn.delay(300)} style={[styles.letterContainer, pulseStyle]}>
            <Text style={styles.letterLabel}>Lettre</Text>
            <View style={styles.letterCircle}>
              <Text style={styles.letter}>{currentLetter.toUpperCase()}</Text>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(400)} style={styles.timerWrapper}>
            <Timer onTimeUp={handleTimeUp} />
          </Animated.View>
        </View>

        <Animated.View entering={FadeInUp.delay(500)} style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <Animated.View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {filledCount}/{categories.length} catégories
          </Text>
        </Animated.View>
      </Animated.View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {categories.map((category, index) => {
          const answer = answers.find((a) => a.categorieId === category.id);
          return (
            <Animated.View key={category.id} entering={FadeInDown.delay(600 + index * 50).springify()}>
              <InputWord
                index={index}
                category={category.nom}
                value={answer?.word || ''}
                onChangeText={(text) => setAnswer(category.id, text)}
                letter={currentLetter}
                editable={!busy}
              />
            </Animated.View>
          );
        })}

        <Animated.View entering={FadeInUp.delay(800)} style={styles.actionsContainer}>
          {reconnecting && (
            <View style={styles.hintBox}>
              <AlertCircle size={16} color="#FF9800" />
              <Text style={styles.hintText}>
                Connexion perdue, reconnexion en cours...
              </Text>
            </View>
          )}

          {opponentLeft && !stopped && (
            <View style={styles.hintBox}>
              <AlertCircle size={16} color="#FF9800" />
              <Text style={styles.hintText}>
                {opponentName} s'est déconnecté. Vous pouvez crier STOP pour terminer.
              </Text>
            </View>
          )}

          {stopped && (
            <Animated.View entering={BounceIn} style={[styles.opponentFinishedNotice, shakeStyle]}>
              <Zap size={24} color="#ff9800" />
              <View style={styles.noticeTextContainer}>
                <Text style={styles.opponentFinishedTitle}>
                  {stoppedReason === 'timeout'
                    ? 'Temps écoulé !'
                    : stoppedByName
                      ? `${stoppedByName} a crié STOP !`
                      : 'STOP !'}
                </Text>
                <Text style={styles.opponentFinishedText}>
                  {submitting ? 'Validation de vos réponses...' : 'Calcul des scores...'}
                </Text>
              </View>
            </Animated.View>
          )}

          <Button
            title={busy ? 'Validation...' : "STOP ! J'ai terminé"}
            onPress={() => triggerStop('manual')}
            variant={allFieldsFilled ? 'primary' : 'danger'}
            loading={busy}
            disabled={busy}
            icon={<Send size={20} color="#fff" />}
          />

          {!allFieldsFilled && !busy && (
            <Animated.View entering={FadeIn.delay(1000)} style={styles.hintBox}>
              <AlertCircle size={16} color="#FF9800" />
              <Text style={styles.hintText}>
                Crier STOP arrête la manche pour tout le monde immédiatement.
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
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 60,
    paddingBottom: 24,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
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
  letterTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 16,
  },
  letterContainer: {
    alignItems: 'center',
  },
  letterLabel: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  letterCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
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
    fontSize: 40,
    fontWeight: '800',
    color: '#007AFF',
    textShadowColor: 'rgba(0, 122, 255, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  timerWrapper: {
    flex: 1,
    maxWidth: 200,
  },
  progressContainer: {
    marginBottom: 4,
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
