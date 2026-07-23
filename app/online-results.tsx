// app/online-results.tsx - RÉSULTATS TEMPS RÉEL (Supabase Realtime)
// Le scoring vient de l'Edge Function via 'all-scores-ready' (stocké dans le gameStore).
// Les manches et l'arrêt de partie passent par services/websocket.ts (Supabase).
import { View, Text, StyleSheet, ScrollView, Dimensions, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import Animated, { FadeInDown, FadeInUp, BounceIn } from 'react-native-reanimated';
import { useGameStore } from '../store/gameStore';
import { useUserStore } from '../store/userStore';
import { recordOnlineGame } from '../services/stats';
import Button from '../components/Button';
import AdBanner from '../components/AdBanner';
import PendingValidationsPanel from '../components/PendingValidationsPanel';
import { maybeShowInterstitial } from '../services/ads';
import { feedback } from '../services/feedback';
import { websocketService, PendingValidationRow } from '../services/websocket';
import { supabase } from '../lib/supabase';
import { normalizeWord } from '../utils/normalize';
import { CheckCircle, XCircle, Trophy, Crown, Play, StopCircle, Star, Award, Zap, HelpCircle } from 'lucide-react-native';
import { colors, fonts, radius, spacing, shadow } from '../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SAFE_AREA_HEIGHT = SCREEN_HEIGHT * 0.25;

// Doit rester aligné sur RESUBMIT_AFTER_MS côté edge function
// (supabase/functions/game-actions/index.ts) et PendingValidationsPanel.
const RESUBMIT_AFTER_MS = 20000;

export default function OnlineResultsScreen() {
  const router = useRouter();

  const {
    results,
    score,
    opponentResults,
    opponentScore,
    opponentName,
    categories,
    currentRound,
    currentLetter,
    roundHistory,
    addRoundToHistory,
    startNewRound,
    resetGame,
    isHost,
    stoppedEarly,
    bonusApplied,
    penaltyApplied,
    opponentBonusApplied,
    opponentPenaltyApplied,
    serverTotalScore,
    serverOpponentTotalScore,
    serverTotalsReady,
    setServerTotals,
  } = useGameStore();

  const [showFinalResults, setShowFinalResults] = useState(false);
  const [waitingForNextRound, setWaitingForNextRound] = useState(false);
  const [opponentGone, setOpponentGone] = useState(false);
  // Toutes les demandes de validation manuelle encore sans réponse dans la
  // room (toutes manches confondues) — voir components/PendingValidationsPanel.
  const [pendingValidations, setPendingValidations] = useState<PendingValidationRow[]>([]);
  // Scores cumulés réels (game_room_players.score) reçus à la fin de partie —
  // lecture la plus fraîche possible au moment précis de la fin ; en cours de
  // partie, `serverTotalScore`/`serverOpponentTotalScore` (store, tenus à
  // jour via onScoreUpdated) servent de source de vérité à la place d'une
  // somme locale de roundHistory.
  const [finalTotals, setFinalTotals] = useState<{ playerId: string; playerName: string; score: number }[] | null>(null);
  // Historique des mots validés par accord mutuel cette partie + verdict IA
  // (ai_result: true/false/undefined = en attente d'une clé Gemini).
  const [dictionaryHistory, setDictionaryHistory] = useState<
    { word: string; categorieName: string; aiResult: boolean | null }[]
  >([]);
  // Même chose mais scopé à la manche en cours : affiché dès l'écran de
  // résultats de manche (pas seulement à l'écran final), pour que le
  // joueur voie que ses mots validés sont bien soumis à l'IA tout de suite.
  const [roundDictionaryHistory, setRoundDictionaryHistory] = useState<
    { word: string; categorieName: string; aiResult: boolean | null }[]
  >([]);

  const committedRef = useRef(false);
  const navigatedRef = useRef(false);

  const playerId = websocketService.getCurrentPlayerId();

  const myResults = results || [];
  const oppResults = opponentResults || [];

  const myFinalScore = score || 0;
  const opponentFinalScore = opponentScore || 0;
  const myValid = myResults.filter((r) => r.isValid).length;
  const oppValid = oppResults.filter((r) => r.isValid).length;

  // Totaux cumulés : repli local uniquement si le serveur n'a jamais répondu
  // (perte réseau) — dans tous les autres cas, le total serveur fait foi.
  // La somme locale de `roundHistory` a un défaut structurel qu'elle seule ne
  // peut pas corriger : un score committé au moment du passage à la manche
  // suivante ne bouge plus jamais ensuite, même si une validation manuelle
  // est résolue après coup sur CETTE manche.
  const histMy = roundHistory.reduce((s, r) => s + r.myScore, 0);
  const histOpp = roundHistory.reduce((s, r) => s + r.opponentScore, 0);
  const localFallbackMy = showFinalResults ? histMy : histMy + myFinalScore;
  const localFallbackOpponent = showFinalResults ? histOpp : histOpp + opponentFinalScore;
  // À la fin de partie, `finalTotals` (reçu via onGameEnded, lecture fraîche
  // de game_room_players au moment précis de la fin) est préféré ; sinon le
  // total serveur tenu à jour en direct ; en dernier recours, le repli local.
  const serverMe = finalTotals?.find((r) => r.playerId === playerId);
  const serverOpp = finalTotals?.find((r) => r.playerId !== playerId);
  const displayMyTotal = serverMe ? serverMe.score : serverTotalsReady ? serverTotalScore : localFallbackMy;
  const displayOpponentTotal = serverOpp ? serverOpp.score : serverTotalsReady ? serverOpponentTotalScore : localFallbackOpponent;

  // Verrou : enregistre la manche courante dans l'historique une seule fois.
  // Lit TOUJOURS l'état le plus frais via getState() au moment de l'appel
  // (jamais les variables du rendu, capturées dans la closure du premier
  // montage) : sinon, une validation manuelle résolue après ce montage mais
  // avant le passage à la manche suivante écrivait encore l'ancien score
  // dans roundHistory, faisant dériver le "Score total" affiché à chaque
  // manche comportant une validation.
  const commitRoundToHistory = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const s = useGameStore.getState();
    const myResultsNow = s.results || [];
    const oppResultsNow = s.opponentResults || [];
    addRoundToHistory({
      roundNumber: s.currentRound,
      letter: s.currentLetter || '',
      myScore: s.score || 0,
      opponentScore: s.opponentScore || 0,
      myValidWords: myResultsNow.filter((r) => r.isValid).length,
      opponentValidWords: oppResultsNow.filter((r) => r.isValid).length,
    });
  };

  // Partie terminée (écran final uniquement) → interstitiel + stats/ELO
  const statsRecordedRef = useRef(false);
  useEffect(() => {
    if (!showFinalResults || statsRecordedRef.current) return;
    statsRecordedRef.current = true;

    maybeShowInterstitial();

    // Son/vibration de fin de partie (rien en cas d'égalité)
    if (displayMyTotal > displayOpponentTotal) {
      feedback.victory();
    } else if (displayMyTotal < displayOpponentTotal) {
      feedback.defeat();
    }

    const s = useGameStore.getState();
    recordOnlineGame({
      userId: useUserStore.getState().user?.id,
      myPlayerId: websocketService.getCurrentPlayerId(),
      myScore: displayMyTotal,
      opponentScore: displayOpponentTotal,
      roundsPlayed: s.roundHistory.length,
      validWords: s.roundHistory.reduce((sum, r) => sum + r.myValidWords, 0),
      bestRoundScore: s.roundHistory.reduce((max, r) => Math.max(max, r.myScore), 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFinalResults]);

  // Relit le score autoritaire de la manche depuis le serveur (recalcul
  // complet : partage des mots dupliqués, pénalité remboursée, bonus de
  // STOP...) au lieu de patcher les points localement — une correction
  // locale ad-hoc ne peut pas reproduire fidèlement ces règles, ce qui
  // provoquait un résumé de manche affichant un mauvais total après une
  // validation manuelle.
  const refreshRoundResults = async () => {
    const fresh = await websocketService.refreshCurrentRoundResults();
    if (!fresh) return;
    const me = fresh.find((r) => r.playerId === playerId);
    const opp = fresh.find((r) => r.playerId !== playerId);
    const s = useGameStore.getState();
    if (me) {
      s.setMultiplayerResults(
        me.results || [],
        me.roundScore || 0,
        me.stoppedEarly || false,
        me.bonusApplied || false,
        me.penaltyApplied || false
      );
    }
    if (opp) {
      s.setOpponentResults(opp.results || [], opp.roundScore || 0, opp.bonusApplied || false, opp.penaltyApplied || false);
    }
    s.setServerTotals(me?.totalScore ?? s.serverTotalScore, opp?.totalScore ?? s.serverOpponentTotalScore);
  };

  // Mots validés par accord mutuel PENDANT LA MANCHE EN COURS + verdict du
  // gate IA (soumis automatiquement en tâche de fond par le serveur à chaque
  // validation résolue, voir game-actions/runDictionaryAIGate).
  const refreshRoundDictionaryHistory = async () => {
    const roundId = websocketService.getCurrentRoundId();
    if (!roundId) return;
    const { data } = await supabase
      .from('word_validation_votes')
      .select('word, ai_checked_at, ai_result, categories(nom)')
      .eq('round_id', roundId)
      .eq('vote', true)
      .order('created_at', { ascending: true });
    setRoundDictionaryHistory(
      (data || []).map((v: any) => ({
        word: v.word,
        categorieName: v.categories?.nom || '',
        aiResult: v.ai_checked_at ? !!v.ai_result : null,
      }))
    );
  };

  // Instantané room-entière des demandes non résolues, pour le panneau
  // persistant. Indépendant des Sets de dédoublonnage internes du service :
  // une demande reste visible/actionnable tant qu'elle n'a pas de réponse,
  // même si l'événement Realtime d'origine a été loupé (cause racine
  // identifiée : plusieurs Alert.alert empilées, dont RN ne garantit pas
  // l'affichage au-delà d'une ou deux).
  const refreshPendingValidations = async () => {
    const roomId = websocketService.getCurrentRoomDbId();
    if (!roomId) return;
    const rows = await websocketService.fetchPendingValidations(roomId);
    setPendingValidations(rows);
  };

  useEffect(() => {
    if (!results) {
      router.replace('/');
      return;
    }

    // Les callbacks de l'écran de jeu (démonté) ne doivent plus réagir ici
    websocketService.clearCallbacks();
    websocketService.setCallbacks({
      // L'hôte (ou n'importe qui) a lancé la manche suivante → tout le monde y va
      onNewRound: (data) => {
        if (navigatedRef.current) return;
        navigatedRef.current = true;
        commitRoundToHistory();
        const s = useGameStore.getState();
        // Numéro de manche + horloge synchronisés sur le serveur
        s.startNewRound(data.letter, data.roundNumber);
        if (data.roundDuration) {
          const elapsedSec = data.startedAt
            ? Math.max(0, (data.timestamp - data.startedAt) / 1000)
            : 0;
          s.syncRoundClock(data.roundDuration, elapsedSec);
        }
        router.replace('/online-game');
      },
      // Fin de partie demandée → écran final pour tous, avec les scores
      // cumulés réels renvoyés par le serveur (game_room_players.score).
      onGameEnded: (data) => {
        commitRoundToHistory();
        setFinalTotals(data.results && data.results.length > 0 ? data.results : null);
        setShowFinalResults(true);
      },
      // Si l'hôte part, le serveur me promeut : je peux lancer la suite
      onHostChanged: (data) => {
        if (data.newHostId === playerId) {
          useGameStore.getState().setIsHost(true);
        }
      },
      onPlayerDisconnected: () => setOpponentGone(true),
      onPlayerLeft: () => setOpponentGone(true),
      onPlayerJoined: () => setOpponentGone(false),
      // Score cumulé serveur, recalculé à chaque finalisation/validation
      // manuelle — y compris celles résolues depuis le panneau persistant
      // pour une manche PASSÉE (le round-id de la ligne modifiée n'a pas
      // besoin de correspondre à la manche affichée ici : c'est justement
      // ce qui permet au total de rester exact malgré l'orphelinage d'une
      // demande après le passage à la manche suivante).
      onScoreUpdated: ({ playerId: updatedId, score: updatedScore }) => {
        const s = useGameStore.getState();
        if (updatedId === playerId) {
          s.setServerTotals(updatedScore, s.serverOpponentTotalScore);
        } else {
          s.setServerTotals(s.serverTotalScore, updatedScore);
        }
      },
      // Validation manuelle par accord mutuel d'un mot absent du
      // dictionnaire. Le panneau persistant (alimenté par polling, voir
      // refreshPendingValidations) est désormais la source d'affichage/
      // d'action pour les demandes reçues — plus de Alert.alert par demande,
      // qui se perdaient silencieusement dès que plusieurs arrivaient
      // rapprochées (RN ne garantit pas l'affichage de boîtes de dialogue
      // empilées). Ce callback ne sert plus qu'à rafraîchir les données dès
      // qu'un événement Realtime arrive, sans attendre le prochain polling.
      onWordValidationVote: (data) => {
        const { playerId: ownerId, word, vote } = data;
        refreshPendingValidations();
        if (vote !== null) {
          if (ownerId === playerId && !vote) {
            Alert.alert('Validation refusée', `${opponentName} n'a pas validé « ${word} ».`);
          }
          refreshRoundResults();
          refreshRoundDictionaryHistory();
        }
      },
    });

    // Rattrapage immédiat au montage, puis polling léger tant que l'écran
    // est affiché : filet contre une éventuelle coupure Realtime ou contre
    // un évènement arrivé pendant la transition entre écrans (fenêtre où
    // aucun callback n'était monté).
    const roundId = websocketService.getCurrentRoundId();
    if (roundId) {
      websocketService.syncWordValidationsForRound(roundId);
      refreshRoundDictionaryHistory();
    }
    refreshPendingValidations();
    const pollInterval = setInterval(() => {
      const rid = websocketService.getCurrentRoundId();
      if (rid) websocketService.syncWordValidationsForRound(rid);
      refreshPendingValidations();
    }, 5000);

    return () => clearInterval(pollInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Historique des mots validés par accord mutuel cette partie + verdict IA
  // (Partie 7) : chargé une fois l'écran final atteint, directement depuis
  // la table (source de vérité serveur).
  useEffect(() => {
    if (!showFinalResults) return;
    const roomDbId = websocketService.getCurrentRoomDbId();
    if (!roomDbId) return;
    supabase
      .from('word_validation_votes')
      .select('word, ai_checked_at, ai_result, categories(nom)')
      .eq('room_id', roomDbId)
      .eq('vote', true)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setDictionaryHistory(
          (data || []).map((v: any) => ({
            word: v.word,
            categorieName: v.categories?.nom || '',
            aiResult: v.ai_checked_at ? !!v.ai_result : null,
          }))
        );
      });
  }, [showFinalResults]);

  const handleNextRound = () => {
    setWaitingForNextRound(true);
    if (isHost) {
      // Le serveur tire lui-même la lettre (game_rooms.used_letters) ;
      // onNewRound fera naviguer tout le monde une fois la manche créée.
      websocketService.nextRound();
    }
    // Le non-hôte attend simplement le 'new-round' du serveur
  };

  const handleStopGame = () => {
    commitRoundToHistory();
    websocketService.endGame(); // serveur → 'game-ended' à tous
    setShowFinalResults(true);
  };

  const handleNewGame = () => {
    websocketService.disconnect();
    resetGame();
    router.replace('/');
  };

  const requestWordValidation = (categorieId: number, categorieName: string, word: string) => {
    websocketService.requestWordValidation(categorieId, categorieName, word).then(() => {
      refreshPendingValidations();
    });
  };

  const handleRespondValidation = (voteId: string, approved: boolean) => {
    websocketService.respondWordValidation(voteId, approved).then(() => {
      refreshPendingValidations();
    });
  };

  const handleResubmitValidation = (row: PendingValidationRow) => {
    websocketService.requestWordValidation(row.categorieId, row.categorieName, row.word, row.roundId).then(() => {
      refreshPendingValidations();
    });
  };

  if (!results) {
    return null;
  }

  const pendingDictionaryCount = dictionaryHistory.filter((w) => w.aiResult === null).length;
  const currentRoundId = websocketService.getCurrentRoundId();

  // ---------- ÉCRAN FINAL ----------
  if (showFinalResults) {
    const isWinner = displayMyTotal > displayOpponentTotal;
    const isDraw = displayMyTotal === displayOpponentTotal;
    const myWordsTotal = roundHistory.reduce((s, r) => s + r.myValidWords, 0);
    const oppWordsTotal = roundHistory.reduce((s, r) => s + r.opponentValidWords, 0);

    return (
      <View style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Animated.View entering={BounceIn.duration(700)} style={styles.winnerSection}>
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
          </Animated.View>

          <PendingValidationsPanel
            pending={pendingValidations}
            myPlayerId={playerId || ''}
            opponentName={opponentName || ''}
            onRespond={handleRespondValidation}
            onResubmit={handleResubmitValidation}
          />

          <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.finalScoresCard}>
            <View style={styles.cardHeader}>
              <Award size={24} color={colors.primary} />
              <Text style={styles.sectionTitle}>Score final</Text>
            </View>

            <View style={styles.finalScoresRow}>
              <View style={[styles.finalScoreBlock, isWinner && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>Vous</Text>
                <Text style={styles.finalScoreValue}>{displayMyTotal}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color={colors.gold} />
                  <Text style={styles.validCount}>{myWordsTotal} mots</Text>
                </View>
              </View>

              <View style={[styles.finalScoreBlock, !isWinner && !isDraw && styles.winnerBlock]}>
                <Text style={styles.playerLabel}>{opponentName}</Text>
                <Text style={styles.finalScoreValue}>{displayOpponentTotal}</Text>
                <View style={styles.statsRow}>
                  <Star size={16} color={colors.gold} />
                  <Text style={styles.validCount}>{oppWordsTotal} mots</Text>
                </View>
              </View>
            </View>
          </Animated.View>

          {dictionaryHistory.length > 0 && (
            <View style={styles.dictionaryHistoryContainer}>
              <Text style={styles.sectionTitle}>Mots ajoutés au dictionnaire</Text>
              {pendingDictionaryCount > 0 && (
                <View style={styles.noKeyBanner}>
                  <Text style={styles.noKeyBannerText}>
                    {pendingDictionaryCount} mot(s) comptent pour votre score mais n'ont pas encore été
                    soumis à l'IA — ajoute une clé Gemini gratuite (aistudio.google.com) dans les
                    réglages pour activer l'ajout automatique au dictionnaire commun.
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
              <Animated.View
                key={index}
                entering={FadeInDown.delay(300 + index * 80).springify()}
                style={styles.historyCard}
              >
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
              </Animated.View>
            ))}
          </View>

          <Animated.View entering={FadeInUp.delay(400)} style={styles.buttonContainer}>
            <Button title="Nouvelle partie" onPress={handleNewGame} />
          </Animated.View>
        </ScrollView>

        <AdBanner />
      </View>
    );
  }

  // ---------- ÉCRAN D'ATTENTE MANCHE SUIVANTE ----------
  if (waitingForNextRound) {
    return (
      <View style={styles.container}>
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingTitle}>
            {isHost ? 'Lancement de la manche...' : "En attente de l'hôte..."}
          </Text>
          <Text style={styles.waitingText}>
            {isHost ? 'Préparation de la nouvelle manche' : `${opponentName} prépare la prochaine manche`}
          </Text>

          {opponentGone && (
            <View style={styles.waitingActions}>
              <Text style={styles.opponentGoneText}>
                ⚠️ {opponentName} semble avoir quitté la partie.
              </Text>
              {isHost && (
                <Button
                  title="Relancer la manche"
                  onPress={() => websocketService.nextRound()}
                  icon={<Play size={20} color={colors.onPrimary} />}
                />
              )}
              <Button
                title="Terminer la partie"
                onPress={handleStopGame}
                variant="secondary"
                icon={<StopCircle size={20} color={colors.primary} />}
              />
            </View>
          )}
        </View>
      </View>
    );
  }

  // ---------- RÉSULTATS DE LA MANCHE ----------
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(400)} style={styles.roundHeader}>
          <Text style={styles.roundTitle}>Manche {currentRound}</Text>
          <View style={styles.letterBadge}>
            <Text style={styles.letterText}>{currentLetter}</Text>
          </View>
        </Animated.View>

        <PendingValidationsPanel
          pending={pendingValidations}
          myPlayerId={playerId || ''}
          opponentName={opponentName || ''}
          onRespond={handleRespondValidation}
          onResubmit={handleResubmitValidation}
        />

        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.scoreCard}>
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
                <Text style={styles.validCount}>{myValid} valides</Text>
              </View>
              {penaltyApplied && <Text style={styles.penaltyText}>⚠️ -3pts (pénalité)</Text>}
              {bonusApplied && <Text style={styles.bonusText}>🎁 +3pts (bonus STOP)</Text>}
            </View>

            <View style={styles.scoreBlock}>
              <Text style={styles.playerLabel}>{opponentName}</Text>
              <Text style={styles.scoreValue}>{opponentFinalScore}</Text>
              <View style={styles.statsRow}>
                <CheckCircle size={16} color={colors.success} />
                <Text style={styles.validCount}>{oppValid} valides</Text>
              </View>
              {opponentPenaltyApplied && <Text style={styles.penaltyText}>⚠️ -3pts (pénalité)</Text>}
              {opponentBonusApplied && <Text style={styles.bonusText}>🎁 +3pts (bonus STOP)</Text>}
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.totalScoreCard}>
          <Text style={styles.totalScoreLabel}>Score total</Text>
          <View style={styles.totalScoreRow}>
            <Text style={styles.totalScoreValue}>{displayMyTotal}</Text>
            <Text style={styles.totalScoreSeparator}>-</Text>
            <Text style={styles.totalScoreValue}>{displayOpponentTotal}</Text>
          </View>
        </Animated.View>

        {roundDictionaryHistory.length > 0 && (
          <View style={styles.dictionaryHistoryContainer}>
            <Text style={styles.sectionTitle}>Mots soumis au dictionnaire</Text>
            {roundDictionaryHistory.some((w) => w.aiResult === null) && (
              <View style={styles.noKeyBanner}>
                <Text style={styles.noKeyBannerText}>
                  Ces mots comptent pour votre score mais ne seront pas ajoutés au dictionnaire
                  commun sans clé Gemini — ajoute une clé gratuite (aistudio.google.com) dans les
                  réglages pour activer l'ajout automatique.
                </Text>
              </View>
            )}
            {roundDictionaryHistory.map((w, index) => (
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

        <View style={styles.comparisonContainer}>
          <Text style={styles.sectionTitle}>Réponses</Text>
          <View style={styles.comparisonLegend}>
            <Text style={styles.legendText}>Vous</Text>
            <Text style={styles.legendText}>{opponentName}</Text>
          </View>
          {categories.map((category, index) => {
            const myAnswer = myResults.find((r) => r.categorieId === category.id);
            const oppAnswer = oppResults.find((r) => r.categorieId === category.id);
            // Règle Petit Bac : même mot valide chez les deux → points partagés
            const isDuplicate = !!(
              myAnswer?.word && oppAnswer?.word &&
              myAnswer.isValid && oppAnswer.isValid &&
              normalizeWord(myAnswer.word) === normalizeWord(oppAnswer.word)
            );
            // Ma demande de validation en cours pour CETTE catégorie de LA
            // manche affichée (dérivé du panneau persistant, plus de state
            // local dupliqué : une seule source de vérité).
            const myPendingRequest = pendingValidations.find(
              (p) => p.ownerId === playerId && p.roundId === currentRoundId && p.categorieId === category.id
            );
            const canResubmitInline =
              myPendingRequest && Date.now() - new Date(myPendingRequest.createdAt).getTime() > RESUBMIT_AFTER_MS;
            return (
              <Animated.View
                key={category.id ?? index}
                entering={FadeInDown.delay(250 + index * 60).springify()}
                style={styles.comparisonCard}
              >
                <Text style={styles.categoryName}>{category.nom}</Text>
                <View style={styles.comparisonRow}>
                  <View style={styles.answerBlock}>
                    {myAnswer?.word ? (
                      <View style={styles.answerContainer}>
                        <Text style={styles.answerWord}>{myAnswer.word}</Text>
                        {myAnswer.isValid ? (
                          <CheckCircle size={20} color={colors.success} />
                        ) : (
                          <XCircle size={20} color={colors.danger} />
                        )}
                        <Text style={styles.pointsText}>+{myAnswer.points}</Text>
                      </View>
                    ) : (
                      <Text style={styles.noAnswer}>-</Text>
                    )}
                    {myAnswer?.word && !myAnswer.isValid && (
                      myPendingRequest ? (
                        canResubmitInline ? (
                          <TouchableOpacity
                            style={styles.validationButton}
                            onPress={() => handleResubmitValidation(myPendingRequest)}
                          >
                            <HelpCircle size={13} color={colors.primary} />
                            <Text style={styles.validationButtonText}>Toujours en attente — Redemander</Text>
                          </TouchableOpacity>
                        ) : (
                          <Text style={styles.validationPending}>En attente...</Text>
                        )
                      ) : (
                        <TouchableOpacity
                          style={styles.validationButton}
                          onPress={() => requestWordValidation(category.id, category.nom, myAnswer.word)}
                        >
                          <HelpCircle size={13} color={colors.primary} />
                          <Text style={styles.validationButtonText}>
                            {myAnswer.manualValidationResult === false ? 'Redemander' : 'Demander validation'}
                          </Text>
                        </TouchableOpacity>
                      )
                    )}
                  </View>

                  <View style={styles.answerBlock}>
                    {oppAnswer?.word ? (
                      <View style={styles.answerContainer}>
                        <Text style={styles.answerWord}>{oppAnswer.word}</Text>
                        {oppAnswer.isValid ? (
                          <CheckCircle size={20} color={colors.success} />
                        ) : (
                          <XCircle size={20} color={colors.danger} />
                        )}
                        <Text style={styles.pointsText}>+{oppAnswer.points}</Text>
                      </View>
                    ) : (
                      <Text style={styles.noAnswer}>-</Text>
                    )}
                  </View>
                </View>
                {isDuplicate && (
                  <View style={styles.duplicateBadge}>
                    <Text style={styles.duplicateText}>🤝 Mots identiques — points partagés</Text>
                  </View>
                )}
              </Animated.View>
            );
          })}
        </View>

        {opponentGone && (
          <View style={styles.opponentGoneBanner}>
            <Text style={styles.opponentGoneText}>
              ⚠️ {opponentName} semble avoir quitté la partie.
            </Text>
          </View>
        )}

        <Animated.View entering={FadeInUp.delay(400)} style={styles.buttonContainer}>
          <Button title="Manche suivante" onPress={handleNextRound} icon={<Play size={20} color={colors.onPrimary} />} />
          <Button
            title="Arrêter la partie"
            onPress={handleStopGame}
            variant="secondary"
            icon={<StopCircle size={20} color={colors.primary} />}
          />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingTop: 60, paddingBottom: SAFE_AREA_HEIGHT },
  roundHeader: {
    alignItems: 'center',
    marginBottom: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  roundTitle: { fontSize: 30, fontFamily: fonts.display, color: colors.text },
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
  letterText: { fontSize: 24, fontFamily: fonts.displayBold, color: colors.goldDeep },
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
  scoreLabel: { fontSize: 18, fontWeight: '700', color: colors.text },
  scoresRow: { flexDirection: 'row', gap: 16 },
  scoreBlock: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: 16,
  },
  playerLabel: { fontSize: 14, color: colors.textSecondary, marginBottom: 8, fontWeight: '600' },
  scoreValue: { fontSize: 48, fontFamily: fonts.displayBold, color: colors.primary, marginBottom: 8 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  validCount: { fontSize: 13, color: colors.textSecondary },
  penaltyText: {
    fontSize: 12,
    color: colors.danger,
    marginTop: 6,
    fontWeight: '700',
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  bonusText: {
    fontSize: 12,
    color: colors.goldDeep,
    marginTop: 6,
    fontWeight: '700',
    backgroundColor: colors.goldSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  totalScoreCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 24,
    alignItems: 'center',
  },
  totalScoreLabel: { fontSize: 14, color: colors.textSecondary, marginBottom: 8, fontWeight: '600' },
  totalScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  totalScoreValue: { fontSize: 32, fontFamily: fonts.displayBold, color: colors.primary },
  totalScoreSeparator: { fontSize: 24, color: colors.textMuted },
  comparisonContainer: { marginBottom: 24 },
  comparisonLegend: {
    flexDirection: 'row',
    marginBottom: 8,
    paddingHorizontal: 16,
    gap: 12,
  },
  legendText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  opponentGoneBanner: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    padding: 12,
    marginBottom: 16,
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
  comparisonRow: { flexDirection: 'row', gap: 12 },
  duplicateBadge: {
    marginTop: 10,
    alignSelf: 'center',
    backgroundColor: colors.goldDeepSoft,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  duplicateText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.goldDeep,
  },
  answerBlock: { flex: 1 },
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
  answerWord: { fontSize: 15, color: colors.text, fontWeight: '600', flex: 1 },
  noAnswer: {
    fontSize: 16,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  pointsText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.success,
    backgroundColor: colors.successSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  buttonContainer: { gap: 12, marginTop: 8 },
  winnerSection: { alignItems: 'center', marginBottom: 32 },
  winnerText: { fontSize: 34, fontFamily: fonts.displayBold, color: colors.success, marginTop: 20 },
  loserText: { fontSize: 30, fontFamily: fonts.display, color: colors.textSecondary, marginTop: 16 },
  winnerName: { fontSize: 20, color: colors.primary, marginTop: 8, fontWeight: '600' },
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
  finalScoresRow: { flexDirection: 'row', gap: 16 },
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
  finalScoreValue: { fontSize: 52, fontFamily: fonts.displayBold, color: colors.primary, marginBottom: 8 },
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
  historyContainer: { marginBottom: 24 },
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
  historyRound: { fontSize: 16, fontWeight: '600', color: colors.text },
  historyScores: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  historyScore: { fontSize: 14, color: colors.textSecondary },
  waitingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  waitingActions: { marginTop: 32, gap: 12, alignSelf: 'stretch' },
  opponentGoneText: {
    fontSize: 14,
    color: colors.goldDeep,
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 4,
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
