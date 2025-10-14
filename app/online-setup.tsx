// app/online-setup.tsx - VERSION COMPLÈTE avec username automatique
import { View, Text, StyleSheet, TextInput, ScrollView, Alert, ActivityIndicator, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import Button from '../components/Button';
import { onlineService, GameRoom, GameRoomPlayer } from '../services/online';
import { useGameStore } from '../store/gameStore';
import { useUserStore } from '../store/userStore'; // ✅ AJOUTÉ
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

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
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

  useEffect(() => {
    if (waitingRoom) {
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
      onlineService.unsubscribeFromRoom();
    };
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

      const interval = setInterval(async () => {
        const updatedPlayers = await onlineService.getPlayers(waitingRoom.roomId);
        setPlayers(updatedPlayers);

        if (updatedPlayers.length >= 2) {
          clearInterval(interval);
          await handleAutoStart();
        }
      }, 1000);

      return () => {
        clearInterval(interval);
      };
    } catch (error) {
      console.error('Error loading players:', error);
      Alert.alert('Erreur', 'Impossible de charger les joueurs');
    }
  }

  async function handleAutoStart() {
    if (!waitingRoom) return;

    try {
      const currentPlayers = await onlineService.getPlayers(waitingRoom.roomId);

      if (currentPlayers.length < 2) {
        Alert.alert('Erreur', 'Pas assez de joueurs');
        return;
      }

      const opponent = currentPlayers.find(p => p.id !== waitingRoom.playerId);

      if (!opponent) {
        Alert.alert('Erreur', 'Adversaire introuvable');
        return;
      }

      if (waitingRoom.isHost) {
        await onlineService.startGame(waitingRoom.roomId);
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      const categories = await getCategories();

      startMultiplayerGame(
        waitingRoom.letter,
        categories,
        waitingRoom.isHost,
        opponent.player_name
      );

      router.push('/online-game');
    } catch (error) {
      console.error('Error starting game:', error);
      Alert.alert('Erreur', 'Impossible de démarrer la partie: ' + (error as Error).message);
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

      const randomLetter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      const { room, player } = await onlineService.createRoom(finalName, randomLetter);

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
      const { room: joinedRoom, player } = await onlineService.joinRoom(room.room_code, finalName);

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
              <Globe size={48} color="#007AFF" />
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
              <Copy size={20} color="#007AFF" />
            </View>
            <Text style={styles.shareHint}>Partagez ce code</Text>
          </Animated.View>

          <Animated.View 
            entering={BounceIn.delay(300)}
            style={styles.letterCardCompact}
          >
            <View style={styles.letterBadgeCompact}>
              <Zap size={24} color="#FFD700" />
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
              <Users size={20} color="#fff" />
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
                      <Crown size={10} color="#333" />
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
                <ActivityIndicator size="small" color="#007AFF" />
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
                <Zap size={24} color="#4caf50" />
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
            icon={<ArrowLeft size={18} color="#007AFF" />}
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
            <UserPlus size={48} color="#007AFF" />
            <Text style={styles.titleCompact}>Créer une salle</Text>
          </Animated.View>

          {/* ✅ AFFICHER USERNAME SI EXISTE, SINON INPUT */}
          {user?.username ? (
            <Animated.View 
              entering={FadeInUp.delay(200).springify()}
              style={styles.playerInfoCard}
            >
              <View style={styles.playerAvatarLarge}>
                <User size={28} color="#fff" />
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
                placeholderTextColor="rgba(255, 255, 255, 0.4)"
                maxLength={20}
                autoCapitalize="words"
              />
            </Animated.View>
          )}

          <Animated.View 
            entering={FadeInUp.delay(300)}
            style={styles.infoCardCompact}
          >
            <Clock size={20} color="#007AFF" />
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
            icon={<UserPlus size={18} color="#fff" />}
          />
          <Button
            title="Retour"
            onPress={handleBack}
            variant="secondary"
            icon={<ArrowLeft size={18} color="#007AFF" />}
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
            <Globe size={48} color="#007AFF" />
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
              <User size={28} color="#fff" />
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
              placeholderTextColor="rgba(255, 255, 255, 0.4)"
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
              <Users size={20} color="#fff" />
              <Text style={styles.roomsTitleCompact}>Salles</Text>
            </View>
            <Button
              title=""
              onPress={handleRefresh}
              variant="secondary"
              icon={<RefreshCw size={18} color="#007AFF" />}
            />
          </View>

          {availableRooms.length === 0 ? (
            <Animated.View 
              entering={FadeIn.delay(400)}
              style={styles.emptyCardCompact}
            >
              <Users size={36} color="rgba(255, 255, 255, 0.3)" />
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
                        <Crown size={12} color="#FFD700" />
                        <Text style={styles.roomItemHostCompact}>{item.host_player_name}</Text>
                      </View>
                      <View style={styles.roomDetailRow}>
                        <Zap size={12} color="#007AFF" />
                        <Text style={styles.roomItemLetterCompact}>Lettre {item.letter}</Text>
                      </View>
                    </View>
                  </View>
                  <Button
                    title="Rejoindre"
                    onPress={() => handleJoinRoom(item)}
                    icon={<LogIn size={14} color="#fff" />}
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
          icon={<UserPlus size={18} color="#fff" />}
        />
        <Button
          title="Retour"
          onPress={handleBack}
          variant="secondary"
          icon={<ArrowLeft size={18} color="#007AFF" />}
        />
      </View>
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
    fontWeight: '800',
    color: '#fff',
    marginTop: 12,
    textShadowColor: 'rgba(0, 122, 255, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  formCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  // ✅ NOUVEAUX STYLES POUR L'AFFICHAGE USERNAME
  playerInfoCard: {
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.3)',
  },
  playerAvatarLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 122, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#007AFF',
  },
  playerInfoContent: {
    flex: 1,
  },
  playerInfoLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 4,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  playerInfoName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },
  // FIN NOUVEAUX STYLES
  infoCardCompact: {
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.3)',
  },
  infoContent: {
    flex: 1,
  },
  infoTitleCompact: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 2,
  },
  infoTextCompact: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 16,
  },
  fixedButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0a0e27',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    gap: 10,
  },
  roomCodeCard: {
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: 'rgba(0, 122, 255, 0.3)',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  roomCodeLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 10,
    fontWeight: '600',
    letterSpacing: 1,
  },
  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  roomCode: {
    fontSize: 42,
    fontWeight: '800',
    color: '#007AFF',
    letterSpacing: 6,
    textShadowColor: 'rgba(0, 122, 255, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  shareHint: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    fontStyle: 'italic',
  },
  letterCardCompact: {
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderColor: 'rgba(255, 215, 0, 0.3)',
  },
  letterBadgeCompact: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  letterContent: {
    flex: 1,
  },
  letterLabelCompact: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 2,
    fontWeight: '600',
  },
  letterCompact: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFD700',
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
    color: '#fff',
  },
  playerCardCompact: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  playerAvatarCompact: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  hostAvatar: {
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    borderColor: '#FFD700',
  },
  playerInitialCompact: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },
  playerInfo: {
    flex: 1,
  },
  playerNameCompact: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 2,
  },
  hostBadgeCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFD700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  hostBadgeTextCompact: {
    fontSize: 10,
    fontWeight: '700',
    color: '#333',
  },
  waitingCardCompact: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  waitingContent: {
    flex: 1,
  },
  waitingTitleCompact: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '700',
    marginBottom: 4,
  },
  waitingTextCompact: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  startingCardCompact: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderWidth: 2,
    borderColor: '#4caf50',
    shadowColor: '#4caf50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  startingTitleCompact: {
    fontSize: 18,
    color: '#4caf50',
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
    color: '#fff',
  },
  roomItemCardCompact: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  roomItemLeft: {
    flex: 1,
    gap: 8,
  },
  roomCodeBadge: {
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.4)',
  },
  roomItemCodeCompact: {
    fontSize: 16,
    fontWeight: '800',
    color: '#007AFF',
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
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
  },
  roomItemLetterCompact: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '600',
  },
  emptyCardCompact: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  emptyTextCompact: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
  },
  emptySubtextCompact: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
  },
});