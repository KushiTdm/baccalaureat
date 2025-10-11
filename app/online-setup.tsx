// app/online-setup.tsx - VERSION AVEC DEBUG
import { View, Text, StyleSheet, TextInput, Alert, ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import Button from '../components/Button';
import { onlineService, GameRoom, GameRoomPlayer } from '../services/online';
import { useGameStore } from '../store/gameStore';
import { getCategories } from '../services/api';
import { Globe, UserPlus, Users, Play, RefreshCw } from 'lucide-react-native';
import { supabase } from '../lib/supabase';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function OnlineSetupScreen() {
  const router = useRouter();
  const { startMultiplayerGame } = useGameStore();
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

  useEffect(() => {
    loadAvailableRooms();
  }, []);

  useEffect(() => {
    if (waitingRoom) {
      console.log('🎮 Waiting room set:', waitingRoom);
      loadPlayersAndWatch();
    }

    return () => {
      onlineService.unsubscribeFromRoom();
    };
  }, [waitingRoom]);

  async function loadAvailableRooms() {
    try {
      console.log('📋 Loading available rooms...');
      const { data, error } = await supabase
        .from('game_rooms')
        .select('*')
        .eq('status', 'waiting')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('❌ Error loading rooms:', error);
        throw error;
      }

      console.log('✅ Rooms loaded:', data?.length || 0);

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
      console.log('✅ Available rooms:', availableRooms.length);
      setAvailableRooms(availableRooms as any);
    } catch (error) {
      console.error('❌ Error loading rooms:', error);
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
      console.log('👥 Loading players for room:', waitingRoom.roomId);
      const playersList = await onlineService.getPlayers(waitingRoom.roomId);
      console.log('✅ Players loaded:', playersList.length, playersList.map(p => p.player_name));
      setPlayers(playersList);

      if (playersList.length >= 2) {
        console.log('🚀 2 players detected, starting game...');
        await handleAutoStart();
        return;
      }

      console.log('⏳ Starting polling for 2nd player...');
      const interval = setInterval(async () => {
        console.log('🔄 Polling for players...');
        const updatedPlayers = await onlineService.getPlayers(waitingRoom.roomId);
        console.log('👥 Current players:', updatedPlayers.length);
        setPlayers(updatedPlayers);

        if (updatedPlayers.length >= 2) {
          console.log('🎉 2 players found!');
          clearInterval(interval);
          await handleAutoStart();
        }
      }, 1000);

      return () => {
        console.log('🛑 Stopping polling');
        clearInterval(interval);
      };
    } catch (error) {
      console.error('❌ Error loading players:', error);
      Alert.alert('Erreur', 'Impossible de charger les joueurs');
    }
  }

  async function handleAutoStart() {
    if (!waitingRoom) {
      console.error('❌ No waiting room!');
      return;
    }

    console.log('🎮 Auto-starting game...');
    console.log('Room:', waitingRoom);

    try {
      // IMPORTANT: Recharger les joueurs dans cette fonction
      console.log('🔄 Reloading players...');
      const currentPlayers = await onlineService.getPlayers(waitingRoom.roomId);
      console.log('✅ Current players loaded:', currentPlayers.length, currentPlayers.map(p => p.player_name));

      if (currentPlayers.length < 2) {
        console.error('❌ Not enough players:', currentPlayers.length);
        Alert.alert('Erreur', 'Pas assez de joueurs');
        return;
      }

      const opponent = currentPlayers.find(p => p.id !== waitingRoom.playerId);
      console.log('👥 Opponent:', opponent?.player_name);

      if (!opponent) {
        console.error('❌ No opponent found!');
        Alert.alert('Erreur', 'Adversaire introuvable');
        return;
      }

      if (waitingRoom.isHost) {
        console.log('👑 I am host, starting game...');
        await onlineService.startGame(waitingRoom.roomId);
        console.log('✅ Game started by host');
      } else {
        console.log('👤 I am not host, waiting...');
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('📚 Loading categories...');
      const categories = await getCategories();
      console.log('✅ Categories loaded:', categories.length);

      console.log('🎯 Starting multiplayer game in store...');
      startMultiplayerGame(
        waitingRoom.letter,
        categories,
        waitingRoom.isHost,
        opponent.player_name
      );

      console.log('🎮 Navigating to game...');
      router.push('/online-game');
      console.log('✅ Navigation complete');
    } catch (error) {
      console.error('❌ Error starting game:', error);
      Alert.alert('Erreur', 'Impossible de démarrer la partie: ' + (error as Error).message);
    }
  }

  async function handleCreateRoom() {
    if (!playerName.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer votre nom');
      return;
    }

    setLoading(true);
    try {
      console.log('🏗️ Creating room for:', playerName);
      const categories = await getCategories();
      if (categories.length === 0) {
        Alert.alert('Erreur', 'Aucune catégorie disponible');
        return;
      }

      const randomLetter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      console.log('🔤 Random letter:', randomLetter);
      
      const { room, player } = await onlineService.createRoom(playerName.trim(), randomLetter);
      console.log('✅ Room created:', room.room_code);
      console.log('✅ Player created:', player.player_name);

      setWaitingRoom({
        roomId: room.id,
        roomCode: room.room_code,
        playerId: player.id,
        isHost: true,
        letter: randomLetter,
      });
    } catch (error) {
      console.error('❌ Error creating room:', error);
      Alert.alert('Erreur', 'Impossible de créer la salle');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom(room: GameRoom) {
    if (!playerName.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer votre nom pour rejoindre');
      return;
    }

    setLoading(true);
    try {
      console.log('🚪 Joining room:', room.room_code, 'as', playerName);
      const { room: joinedRoom, player } = await onlineService.joinRoom(room.room_code, playerName.trim());
      console.log('✅ Joined room:', joinedRoom.room_code);
      console.log('✅ Player created:', player.player_name, 'ID:', player.id);

      const waitingRoomData = {
        roomId: joinedRoom.id,
        roomCode: joinedRoom.room_code,
        playerId: player.id,
        isHost: false,
        letter: joinedRoom.letter,
      };

      console.log('💾 Setting waiting room:', waitingRoomData);
      setWaitingRoom(waitingRoomData);
    } catch (error: any) {
      console.error('❌ Error joining room:', error);
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

  // ÉCRAN D'ATTENTE
  if (waitingRoom) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Globe size={48} color="#007AFF" />
          <Text style={styles.title}>Salle d'attente</Text>
        </View>

        <View style={styles.roomCodeCard}>
          <Text style={styles.roomCodeLabel}>Code de la salle</Text>
          <Text style={styles.roomCode}>{waitingRoom.roomCode}</Text>
        </View>

        <View style={styles.letterCard}>
          <Text style={styles.letterLabel}>Lettre</Text>
          <Text style={styles.letter}>{waitingRoom.letter}</Text>
        </View>

        <View style={styles.playersSection}>
          <Text style={styles.playersTitle}>
            Joueurs ({players.length}/2)
          </Text>
          {players.map((player) => (
            <View key={player.id} style={styles.playerCard}>
              <Users size={24} color="#007AFF" />
              <Text style={styles.playerName}>{player.player_name}</Text>
              {player.is_host && (
                <View style={styles.hostBadge}>
                  <Text style={styles.hostBadgeText}>Hôte</Text>
                </View>
              )}
            </View>
          ))}

          {players.length < 2 && (
            <View style={styles.waitingCard}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.waitingText}>
                En attente d'un adversaire...
              </Text>
            </View>
          )}

          {players.length >= 2 && (
            <View style={styles.startingCard}>
              <ActivityIndicator size="small" color="#4caf50" />
              <Text style={styles.startingText}>
                Lancement de la partie...
              </Text>
            </View>
          )}
        </View>

        <View style={styles.debugInfo}>
          <Text style={styles.debugText}>
            Room ID: {waitingRoom.roomId.substring(0, 8)}...
          </Text>
          <Text style={styles.debugText}>
            Player ID: {waitingRoom.playerId.substring(0, 8)}...
          </Text>
          <Text style={styles.debugText}>
            Is Host: {waitingRoom.isHost ? 'Oui' : 'Non'}
          </Text>
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Quitter"
            onPress={handleBack}
            variant="secondary"
          />
        </View>
      </View>
    );
  }

  // ÉCRAN CRÉATION
  if (mode === 'create') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Globe size={48} color="#007AFF" />
          <Text style={styles.title}>Créer une salle</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.label}>Votre nom</Text>
          <TextInput
            style={styles.input}
            value={playerName}
            onChangeText={setPlayerName}
            placeholder="Entrez votre nom"
            maxLength={20}
            autoCapitalize="words"
          />
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            La partie se lancera automatiquement dès qu'un autre joueur rejoindra votre salle.
          </Text>
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Créer la salle"
            onPress={handleCreateRoom}
            loading={loading}
          />
          <Button
            title="Retour"
            onPress={handleBack}
            variant="secondary"
          />
        </View>
      </View>
    );
  }

  // ÉCRAN MENU PRINCIPAL
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Globe size={48} color="#007AFF" />
        <Text style={styles.title}>Jeu en ligne</Text>
        <Text style={styles.subtitle}>Trouvez ou créez une salle</Text>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.label}>Votre nom</Text>
        <TextInput
          style={styles.input}
          value={playerName}
          onChangeText={setPlayerName}
          placeholder="Entrez votre nom"
          maxLength={20}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.roomsSection}>
        <View style={styles.roomsHeader}>
          <Text style={styles.roomsTitle}>Salles disponibles</Text>
          <Button
            title=""
            onPress={handleRefresh}
            variant="secondary"
            icon={<RefreshCw size={20} color="#007AFF" />}
          />
        </View>

        {availableRooms.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Aucune salle disponible</Text>
            <Text style={styles.emptySubtext}>Créez-en une nouvelle !</Text>
          </View>
        ) : (
          <FlatList
            data={availableRooms}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
            renderItem={({ item }) => (
              <View style={styles.roomItemCard}>
                <View style={styles.roomInfo}>
                  <Text style={styles.roomItemCode}>{item.room_code}</Text>
                  <Text style={styles.roomItemHost}>Hôte: {item.host_player_name}</Text>
                  <Text style={styles.roomItemLetter}>Lettre: {item.letter}</Text>
                </View>
                <Button
                  title="Rejoindre"
                  onPress={() => handleJoinRoom(item)}
                  icon={<Play size={16} color="#fff" />}
                  disabled={loading}
                />
              </View>
            )}
            style={styles.roomsList}
          />
        )}
      </View>

      <View style={styles.buttonContainer}>
        <Button
          title="Créer une nouvelle salle"
          onPress={() => setMode('create')}
          icon={<UserPlus size={20} color="#fff" />}
        />
        <Button
          title="Retour"
          onPress={handleBack}
          variant="secondary"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
    paddingTop: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#333',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    color: '#333',
  },
  infoCard: {
    backgroundColor: '#e3f2fd',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  infoText: {
    fontSize: 14,
    color: '#1976d2',
    lineHeight: 20,
  },
  buttonContainer: {
    gap: 12,
    marginTop: 'auto',
  },
  roomCodeCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  roomCodeLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  roomCode: {
    fontSize: 48,
    fontWeight: '700',
    color: '#007AFF',
    letterSpacing: 8,
  },
  letterCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  letterLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  letter: {
    fontSize: 64,
    fontWeight: '700',
    color: '#007AFF',
  },
  playersSection: {
    flex: 1,
    marginBottom: 20,
  },
  playersTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  playerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  playerName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  hostBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  hostBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  waitingCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  waitingText: {
    fontSize: 16,
    color: '#666',
  },
  startingCard: {
    backgroundColor: '#e8f5e9',
    borderRadius: 12,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  startingText: {
    fontSize: 16,
    color: '#4caf50',
    fontWeight: '600',
  },
  debugInfo: {
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  debugText: {
    fontSize: 12,
    color: '#856404',
    fontFamily: 'monospace',
  },
  roomsSection: {
    flex: 1,
    marginBottom: 20,
  },
  roomsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  roomsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  roomsList: {
    flex: 1,
  },
  roomItemCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  roomInfo: {
    flex: 1,
  },
  roomItemCode: {
    fontSize: 20,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 4,
  },
  roomItemHost: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  roomItemLetter: {
    fontSize: 14,
    color: '#666',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
  },
});