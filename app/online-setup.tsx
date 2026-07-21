// app/online-setup.tsx - VERSION COMPLÈTE avec username automatique
import { View, Text, StyleSheet, TextInput, ScrollView, Alert, ActivityIndicator, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import Button from '../components/Button';
import { onlineService, GameRoom, GameRoomPlayer } from '../services/online';
import { websocketService } from '../services/websocket';
import { useGameStore } from '../store/gameStore';
import { useUserStore } from '../store/userStore'; // ✅ AJOUTÉ
import { useSettingsStore } from '../store/settingsStore';
import { getCategories } from '../services/api';
import { Globe, UserPlus, Users, Play, RefreshCw, ArrowLeft, Copy, Clock, Zap, Crown, LogIn, User } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import Animated, { 
  FadeIn, 
  FadeInDown, 
  FadeInUp, 
  SlideInLeft,
  BounceIn,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { pickRandomLetter } from '../utils/letters';
import { colors, fonts, radius, spacing, shadow } from '../constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SAFE_BOTTOM_HEIGHT = SCREEN_HEIGHT * 0.12;

export default function OnlineSetupScreen() {
  const router = useRouter();
  const { startMultiplayerGame } = useGameStore();
  const { user } = useUserStore(); // ✅ Récupérer l'utilisateur connecté
  const pulseAnim = useSharedValue(1);
  const rotateAnim = useSharedValue(0);
  
  const [mode, setMode] = useState<'menu' | 'create'>('menu');
  const [playerName, setPlayerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<GameRoom[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [waitingRoom, setWaitingRoom] = useState<{
    roomId: string;
    roomCode: string;
    playerId: string;
    isHost: boolean;
    letter: string;
  } | null>(null);
  const [players, setPlayers] = useState<GameRoomPlayer[]>([]);

  // Le polling de la salle d'attente DOIT être arrêté quand on quitte
  // l'écran/la salle, sinon il continue en arrière-plan et peut nous
  // auto-démarrer dans la partie d'autres joueurs.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRef = useRef(false);

  // ✅ Initialiser le nom avec le username de l'utilisateur
  useEffect(() => {
    if (user?.username) {
      setPlayerName(user.username);
    }
  }, [user]);

  useEffect(() => {
    loadAvailableRooms();

    rotateAnim.value = withRepeat(
      withTiming(360, { duration: 20000 }),
      -1,
      false
    );
  }, []);

  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }

  useEffect(() => {
    if (waitingRoom) {
      startingRef.current = false;
      pulseAnim.value = withRepeat(
        withSequence(
          withSpring(1.05, { damping: 2 }),
          withSpring(1, { damping: 2 })
        ),
        -1,
        true
      );

      loadPlayersAndWatch();
    }

    return () => {
      stopPolling();
      onlineService.unsubscribeFromRoom();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingRoom]);

  async function loadAvailableRooms() {
    try {
      const { data, error } = await supabase
        .from('game_rooms')
        .select('*')
        .eq('status', 'waiting')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      const roomsWithCount = await Promise.all(
        (data || []).map(async (room) => {
          const { data: players } = await supabase
            .from('game_room_players')
            .select('id')
            .eq('room_id', room.id);

          return {
            ...room,
            playerCount: players?.length || 0,
          };
        })
      );

      const availableRooms = roomsWithCount.filter(r => r.playerCount < r.max_players);
      setAvailableRooms(availableRooms as any);
    } catch (error) {
      console.error('Error loading rooms:', error);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadAvailableRooms();
    setRefreshing(false);
  }

  async function loadPlayersAndWatch() {
    if (!waitingRoom) return;

    try {
      const playersList = await onlineService.getPlayers(waitingRoom.roomId);
      setPlayers(playersList);

      if (playersList.length >= 2) {
        await handleAutoStart();
        return;
      }

      stopPolling();
      pollIntervalRef.current = setInterval(async () => {
        try {
          // L'hôte a pu fermer la salle pendant qu'on attendait
          const room = await onlineService.getRoom(waitingRoom.roomId);
          if (!room) {
            stopPolling();
            setWaitingRoom(null);
            setPlayers([]);
            loadAvailableRooms();
            Alert.alert('Salle fermée', "L'hôte a quitté la salle.");
            return;
          }

          const updatedPlayers = await onlineService.getPlayers(waitingRoom.roomId);
          setPlayers(updatedPlayers);

          if (updatedPlayers.length >= 2) {
            stopPolling();
            await handleAutoStart();
          }
        } catch (pollError) {
          console.error('Polling error:', pollError);
        }
      }, 1000);
    } catch (error) {
      console.error('Error loading players:', error);
      Alert.alert('Erreur', 'Impossible de charger les joueurs');
    }
  }

  async function handleAutoStart() {
    if (!waitingRoom) return;
    // Garde anti double-démarrage (poll + appel direct)
    if (startingRef.current) return;
    startingRef.current = true;

    try {
      const currentPlayers = await onlineService.getPlayers(waitingRoom.roomId);

      if (currentPlayers.length < 2) {
        startingRef.current = false;
        Alert.alert('Erreur', 'Pas assez de joueurs');
        return;
      }

      const opponent = currentPlayers.find(p => p.id !== waitingRoom.playerId);

      if (!opponent) {
        startingRef.current = false;
        Alert.alert('Erreur', 'Adversaire introuvable');
        return;
      }

      const categories = await getCategories();

      // --- Bascule sur le canal Realtime pour le gameplay ---
      // (Tout reste Supabase : le lobby utilisait déjà des requêtes directes,
      // le STOP simultané et le scoring passent par services/websocket.ts,
      // room = room_code partagé.)
      const me = currentPlayers.find(p => p.id === waitingRoom.playerId);
      const myName = me?.player_name || user?.username || playerName || 'Joueur';

      await websocketService.connect();
      websocketService.setPlayerInfo(waitingRoom.playerId, myName);

      // Enregistré AVANT joinRoom : game-started peut arriver pendant la
      // navigation (écran de jeu pas encore monté). Ce handler n'agit que
      // sur le store → l'horloge est synchronisée quoi qu'il arrive.
      websocketService.clearCallbacks();
      websocketService.setCallbacks({
        onGameStarted: (data) => {
          const s = useGameStore.getState();
          if (data.letter) s.setLetter(data.letter);
          if (data.roundNumber) useGameStore.setState({ currentRound: data.roundNumber });
          const elapsedSec = data.startedAt
            ? Math.max(0, (data.timestamp - data.startedAt) / 1000)
            : 0;
          s.syncRoundClock(data.roundDuration || 120, elapsedSec);
        },
      });

      // CORRECTIF (bug "se retrouve seul") : joinRoom était auparavant
      // fire-and-forget — un échec silencieux du canal Realtime (ou de la
      // création de la manche par l'hôte, appelée sans attendre juste après)
      // n'empêchait pas la navigation vers /online-game. L'un des deux
      // joueurs pouvait donc se retrouver à jouer seul, la partie n'étant
      // jamais réellement synchronisée côté serveur. On attend maintenant
      // chaque étape et on n'avance QUE si elle a réellement réussi.
      const joined = await websocketService.joinRoom(waitingRoom.roomCode, waitingRoom.playerId, myName);
      if (!joined) {
        throw new Error('Connexion au canal temps réel impossible');
      }

      if (waitingRoom.isHost) {
        const started = await websocketService.startGame(
          waitingRoom.letter,
          useSettingsStore.getState().roundDurationSec
        );
        if (!started) {
          throw new Error('Impossible de créer la manche');
        }
        // La room ne bascule en 'playing' (et disparaît du lobby public)
        // qu'une fois la manche réellement créée — sinon une salle "playing"
        // sans aucune manche resterait bloquée, impossible à retenter.
        try {
          await onlineService.startGame(waitingRoom.roomId);
        } catch (statusError) {
          console.warn('Mise à jour du statut de la salle échouée (non bloquant):', statusError);
        }
      }

      startMultiplayerGame(
        waitingRoom.letter,
        categories,
        waitingRoom.isHost,
        opponent.player_name
      );

      router.push('/online-game');
    } catch (error) {
      console.error('Error starting game:', error);
      startingRef.current = false;
      Alert.alert(
        'Erreur',
        'Impossible de démarrer la partie (' + (error as Error).message + '). Nouvelle tentative...'
      );
      // Ne laisse pas le joueur bloqué dans une salle d'attente sans issue :
      // on relance la surveillance, qui retentera dès le prochain tick.
      setTimeout(() => loadPlayersAndWatch(), 2000);
    }
  }

  async function handleCreateRoom() {
    // ✅ Utiliser le username ou demander un nom
    const finalName = user?.username || playerName.trim();
    
    if (!finalName) {
      Alert.alert('Erreur', 'Veuillez entrer votre nom');
      return;
    }

    setLoading(true);
    try {
      const categories = await getCategories();
      if (categories.length === 0) {
        Alert.alert('Erreur', 'Aucune catégorie disponible');
        return;
      }

      const randomLetter = pickRandomLetter();
      const { room, player } = await onlineService.createRoom(finalName, randomLetter, user?.id);

      setWaitingRoom({
        roomId: room.id,
        roomCode: room.room_code,
        playerId: player.id,
        isHost: true,
        letter: randomLetter,
      });
    } catch (error) {
      console.error('Error creating room:', error);
      Alert.alert('Erreur', 'Impossible de créer la salle');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom(room: GameRoom) {
    // ✅ Utiliser le username ou demander un nom
    const finalName = user?.username || playerName.trim();
    
    if (!finalName) {
      Alert.alert('Erreur', 'Veuillez entrer votre nom pour rejoindre');
      return;
    }

    setLoading(true);
    try {
      const { room: joinedRoom, player } = await onlineService.joinRoom(room.room_code, finalName, user?.id);

      const waitingRoomData = {
        roomId: joinedRoom.id,
        roomCode: joinedRoom.room_code,
        playerId: player.id,
        isHost: false,
        letter: joinedRoom.letter,
      };

      setWaitingRoom(waitingRoomData);
    } catch (error: any) {
      console.error('Error joining room:', error);
      Alert.alert('Erreur', error.message || 'Impossible de rejoindre la salle');
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    if (waitingRoom) {
      Alert.alert(
        'Quitter la salle',
        'Êtes-vous sûr de vouloir quitter ?',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Quitter',
            style: 'destructive',
            onPress: async () => {
              await onlineService.leaveRoom(waitingRoom.roomId, waitingRoom.playerId);
              onlineService.clearCurrentRoom();
              setWaitingRoom(null);
              setPlayers([]);
              setMode('menu');
              loadAvailableRooms();
            },
          },
        ]
      );
    } else {
      if (mode === 'menu') {
        router.back();
      } else {
        setMode('menu');
      }
    }
  }

  const pulseStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: pulseAnim.value }],
    };
  });

  const rotateStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${rotateAnim.value}deg` }],
    };
  });

  // ÉCRAN D'ATTENTE
  if (waitingRoom) {
    return (
      <View style={styles.container}>
        <Animated.View 
          entering={FadeIn.duration(600)} 
          style={styles.backgroundGradient}
        />

        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View 
            entering={FadeInDown.delay(100).springify()}
            style={styles.headerCompact}
          >
            <Animated.View style={rotateStyle}>
              <Globe size={48} color={colors.primary} />
            </Animated.View>
            <Text style={styles.titleCompact}>Salle d'attente</Text>
          </Animated.View>

          <Animated.View 
            entering={ZoomIn.delay(200).springify()}
            style={[styles.roomCodeCard, pulseStyle]}
          >
            <Text style={styles.roomCodeLabel}>Code</Text>
            <View style={styles.codeContainer}>
              <Text style={styles.roomCode}>{waitingRoom.roomCode}</Text>
              <Copy size={20} color={colors.primary} />
            </View>
            <Text style={styles.shareHint}>Partagez ce code</Text>
          </Animated.View>

          <Animated.View 
            entering={BounceIn.delay(300)}
            style={styles.letterCardCompact}
          >
            <View style={styles.letterBadgeCompact}>
              <Zap size={24} color={colors.gold} />
            </View>
            <View style={styles.letterContent}>
              <Text style={styles.letterLabelCompact}>Lettre</Text>
              <Text style={styles.letterCompact}>{waitingRoom.letter}</Text>
            </View>
          </Animated.View>

          <Animated.View 
            entering={FadeInUp.delay(400)}
            style={styles.playersSectionCompact}
          >
            <View style={styles.playersSectionHeader}>
              <Users size={20} color={colors.text} />
              <Text style={styles.playersTitleCompact}>
                Joueurs ({players.length}/2)
              </Text>
            </View>

            {players.map((player, index) => (
              <Animated.View
                key={player.id}
                entering={SlideInLeft.delay(500 + index * 100).springify()}
                style={styles.playerCardCompact}
              >
                <View style={[
                  styles.playerAvatarCompact,
                  player.is_host && styles.hostAvatar
                ]}>
                  <Text style={styles.playerInitialCompact}>
                    {player.player_name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.playerInfo}>
                  <Text style={styles.playerNameCompact}>{player.player_name}</Text>
                  {player.is_host && (
                    <View style={styles.hostBadgeCompact}>
                      <Crown size={10} color={colors.onPrimary} />
                      <Text style={styles.hostBadgeTextCompact}>Hôte</Text>
                    </View>
                  )}
                </View>
              </Animated.View>
            ))}

            {players.length < 2 && (
              <Animated.View 
                entering={FadeIn.delay(600)}
                style={styles.waitingCardCompact}
              >
                <ActivityIndicator size="small" color={colors.primary} />
                <View style={styles.waitingContent}>
                  <Text style={styles.waitingTitleCompact}>En attente...</Text>
                  <Text style={styles.waitingTextCompact}>
                    Un adversaire rejoindra bientôt
                  </Text>
                </View>
              </Animated.View>
            )}

            {players.length >= 2 && (
              <Animated.View 
                entering={BounceIn}
                style={styles.startingCardCompact}
              >
                <Zap size={24} color={colors.success} />
                <Text style={styles.startingTitleCompact}>C'est parti !</Text>
              </Animated.View>
            )}
          </Animated.View>
        </ScrollView>

        <View style={styles.fixedButtonContainer}>
          <Button
            title="Quitter"
            onPress={handleBack}
            variant="secondary"
            icon={<ArrowLeft size={18} color={colors.primary} />}
          />
        </View>
      </View>
    );
  }

  // ÉCRAN CRÉATION
  if (mode === 'create') {
    return (
      <View style={styles.container}>
        <Animated.View 
          entering={FadeIn.duration(600)} 
          style={styles.backgroundGradient}
        />

        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View 
            entering={FadeInDown.delay(100).springify()}
            style={styles.headerCompact}
          >
            <UserPlus size={48} color={colors.primary} />
            <Text style={styles.titleCompact}>Créer une salle</Text>
          </Animated.View>

          {/* ✅ AFFICHER USERNAME SI EXISTE, SINON INPUT */}
          {user?.username ? (
            <Animated.View 
              entering={FadeInUp.delay(200).springify()}
              style={styles.playerInfoCard}
            >
              <View style={styles.playerAvatarLarge}>
                <User size={28} color={colors.onPrimary} />
              </View>
              <View style={styles.playerInfoContent}>
                <Text style={styles.playerInfoLabel}>Vous jouez en tant que</Text>
                <Text style={styles.playerInfoName}>{user.username}</Text>
              </View>
            </Animated.View>
          ) : (
            <Animated.View 
              entering={FadeInUp.delay(200).springify()}
              style={styles.formCard}
            >
              <Text style={styles.label}>Votre nom</Text>
              <TextInput
                style={styles.input}
                value={playerName}
                onChangeText={setPlayerName}
                placeholder="Entrez votre nom"
                placeholderTextColor={colors.textMuted}
                maxLength={20}
                autoCapitalize="words"
              />
            </Animated.View>
          )}

          <Animated.View 
            entering={FadeInUp.delay(300)}
            style={styles.infoCardCompact}
          >
            <Clock size={20} color={colors.primary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitleCompact}>Démarrage auto</Text>
              <Text style={styles.infoTextCompact}>
                Partie lancée dès qu'un joueur rejoint
              </Text>
            </View>
          </Animated.View>
        </ScrollView>

        <View style={styles.fixedButtonContainer}>
          <Button
            title="Créer"
            onPress={handleCreateRoom}
            loading={loading}
            icon={<UserPlus size={18} color={colors.onPrimary} />}
          />
          <Button
            title="Retour"
            onPress={handleBack}
            variant="secondary"
            icon={<ArrowLeft size={18} color={colors.primary} />}
          />
        </View>
      </View>
    );
  }

  // ÉCRAN MENU PRINCIPAL
  return (
    <View style={styles.container}>
      <Animated.View 
        entering={FadeIn.duration(600)} 
        style={styles.backgroundGradient}
      />

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View 
          entering={FadeInDown.delay(100).springify()}
          style={styles.headerCompact}
        >
          <Animated.View style={rotateStyle}>
            <Globe size={48} color={colors.primary} />
          </Animated.View>
          <Text style={styles.titleCompact}>Jeu en ligne</Text>
        </Animated.View>

        {/* ✅ AFFICHER USERNAME SI EXISTE, SINON INPUT */}
        {user?.username ? (
          <Animated.View 
            entering={FadeInUp.delay(200).springify()}
            style={styles.playerInfoCard}
          >
            <View style={styles.playerAvatarLarge}>
              <User size={28} color={colors.onPrimary} />
            </View>
            <View style={styles.playerInfoContent}>
              <Text style={styles.playerInfoLabel}>Vous jouez en tant que</Text>
              <Text style={styles.playerInfoName}>{user.username}</Text>
            </View>
          </Animated.View>
        ) : (
          <Animated.View 
            entering={FadeInUp.delay(200).springify()}
            style={styles.formCard}
          >
            <Text style={styles.label}>Votre nom</Text>
            <TextInput
              style={styles.input}
              value={playerName}
              onChangeText={setPlayerName}
              placeholder="Entrez votre nom"
              placeholderTextColor={colors.textMuted}
              maxLength={20}
              autoCapitalize="words"
            />
          </Animated.View>
        )}

        <Animated.View 
          entering={FadeInUp.delay(300)}
          style={styles.roomsSectionCompact}
        >
          <View style={styles.roomsHeader}>
            <View style={styles.roomsHeaderLeft}>
              <Users size={20} color={colors.text} />
              <Text style={styles.roomsTitleCompact}>Salles</Text>
            </View>
            <Button
              title=""
              onPress={handleRefresh}
              variant="secondary"
              icon={<RefreshCw size={18} color={colors.primary} />}
            />
          </View>

          {availableRooms.length === 0 ? (
            <Animated.View 
              entering={FadeIn.delay(400)}
              style={styles.emptyCardCompact}
            >
              <Users size={36} color={colors.textMuted} />
              <Text style={styles.emptyTextCompact}>Aucune salle</Text>
              <Text style={styles.emptySubtextCompact}>Créez-en une !</Text>
            </Animated.View>
          ) : (
            availableRooms.map((item, index) => (
              <Animated.View
                key={item.id}
                entering={FadeInDown.delay(400 + index * 50).springify()}
              >
                <View style={styles.roomItemCardCompact}>
                  <View style={styles.roomItemLeft}>
                    <View style={styles.roomCodeBadge}>
                      <Text style={styles.roomItemCodeCompact}>{item.room_code}</Text>
                    </View>
                    <View style={styles.roomDetails}>
                      <View style={styles.roomDetailRow}>
                        <Crown size={12} color={colors.gold} />
                        <Text style={styles.roomItemHostCompact}>{item.host_player_name}</Text>
                      </View>
                      <View style={styles.roomDetailRow}>
                        <Zap size={12} color={colors.primary} />
                        <Text style={styles.roomItemLetterCompact}>Lettre {item.letter}</Text>
                      </View>
                    </View>
                  </View>
                  <Button
                    title="Rejoindre"
                    onPress={() => handleJoinRoom(item)}
                    icon={<LogIn size={14} color={colors.onPrimary} />}
                    disabled={loading}
                  />
                </View>
              </Animated.View>
            ))
          )}
        </Animated.View>
      </ScrollView>

      <View style={styles.fixedButtonContainer}>
        <Button
          title="Créer une salle"
          onPress={() => setMode('create')}
          icon={<UserPlus size={18} color={colors.onPrimary} />}
        />
        <Button
          title="Retour"
          onPress={handleBack}
          variant="secondary"
          icon={<ArrowLeft size={18} color={colors.primary} />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 50,
    paddingBottom: SAFE_BOTTOM_HEIGHT + 20,
  },
  headerCompact: {
    alignItems: 'center',
    marginBottom: 20,
  },
  titleCompact: {
    fontSize: 28,
    fontFamily: fonts.display,
    color: colors.text,
    marginTop: 12,
  },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 16,
    ...shadow.card,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // ✅ NOUVEAUX STYLES POUR L'AFFICHAGE USERNAME
  playerInfoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    ...shadow.card,
  },
  playerAvatarLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerInfoContent: {
    flex: 1,
  },
  playerInfoLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  playerInfoName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  // FIN NOUVEAUX STYLES
  infoCardCompact: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoTitleCompact: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  infoTextCompact: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  fixedButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 10,
  },
  roomCodeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: colors.primarySoft,
    ...shadow.glow(colors.primary),
  },
  roomCodeLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 10,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  roomCode: {
    fontSize: 42,
    fontFamily: fonts.displayBold,
    color: colors.primary,
    letterSpacing: 6,
  },
  shareHint: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  letterCardCompact: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderColor: colors.goldBorder,
  },
  letterBadgeCompact: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  letterContent: {
    flex: 1,
  },
  letterLabelCompact: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  letterCompact: {
    fontSize: 28,
    fontFamily: fonts.displayBold,
    color: colors.goldDeep,
  },
  playersSectionCompact: {
    marginBottom: 16,
  },
  playersSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  playersTitleCompact: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  playerCardCompact: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    ...shadow.card,
  },
  playerAvatarCompact: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  hostAvatar: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.gold,
  },
  playerInitialCompact: {
    fontSize: 18,
    fontFamily: fonts.displayBold,
    color: colors.text,
  },
  playerInfo: {
    flex: 1,
  },
  playerNameCompact: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  hostBadgeCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.gold,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  hostBadgeTextCompact: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  waitingCardCompact: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...shadow.card,
  },
  waitingContent: {
    flex: 1,
  },
  waitingTitleCompact: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 4,
  },
  waitingTextCompact: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  startingCardCompact: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.lg,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderWidth: 2,
    borderColor: colors.success,
    ...shadow.glow(colors.success),
  },
  startingTitleCompact: {
    fontSize: 18,
    color: colors.success,
    fontWeight: '800',
  },
  roomsSectionCompact: {
    marginBottom: 16,
  },
  roomsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  roomsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roomsTitleCompact: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  roomItemCardCompact: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    ...shadow.card,
  },
  roomItemLeft: {
    flex: 1,
    gap: 8,
  },
  roomCodeBadge: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  roomItemCodeCompact: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
    color: colors.primary,
    letterSpacing: 1.5,
  },
  roomDetails: {
    gap: 4,
  },
  roomDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roomItemHostCompact: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  roomItemLetterCompact: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  emptyCardCompact: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 32,
    alignItems: 'center',
    ...shadow.card,
  },
  emptyTextCompact: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
  },
  emptySubtextCompact: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});