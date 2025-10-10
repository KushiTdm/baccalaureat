// app/online-setup.tsx
import { View, Text, StyleSheet, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import Button from '../components/Button';
import { onlineService, GameRoomPlayer } from '../services/online';
import { useGameStore } from '../store/gameStore';
import { getCategories } from '../services/api';
import { Globe, UserPlus, Users } from 'lucide-react-native';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function OnlineSetupScreen() {
  const router = useRouter();
  const { startMultiplayerGame } = useGameStore();
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [waitingRoom, setWaitingRoom] = useState<{
    roomId: string;
    roomCode: string;
    playerId: string;
    isHost: boolean;
    letter: string;
  } | null>(null);
  const [players, setPlayers] = useState<GameRoomPlayer[]>([]);

  useEffect(() => {
  if (waitingRoom) {
    // Charger les joueurs d'abord, PUIS souscrire
    loadPlayers().then(() => {
      subscribeToRoom();
    });
  }

  return () => {
    onlineService.unsubscribeFromRoom();
  };
}, [waitingRoom]);

// ✅ La fonction loadPlayers reste IDENTIQUE (pas de changement de nom)
async function loadPlayers() {
  if (!waitingRoom) return;
  
  try {
    const playersList = await onlineService.getPlayers(waitingRoom.roomId);
    setPlayers(playersList);
  } catch (error) {
    console.error('Error loading players:', error);
  }
}

// ✅ MODIFIER subscribeToRoom pour éviter les doublons :
function subscribeToRoom() {
  if (!waitingRoom) return;

  onlineService.subscribeToRoom(waitingRoom.roomId, {
    onPlayerJoined: (player) => {
      // Vérifier que le joueur n'existe pas déjà
      setPlayers(prev => {
        const exists = prev.find(p => p.id === player.id);
        if (exists) return prev;
        return [...prev, player];
      });
    },
    onPlayerLeft: (playerId) => {
      setPlayers(prev => prev.filter(p => p.id !== playerId));
      
      const wasHost = players.find(p => p.id === playerId)?.is_host;
      if (wasHost) {
        Alert.alert(
          'Salle fermée',
          "L'hôte a quitté la salle",
          [{ text: 'OK', onPress: () => {
            onlineService.clearCurrentRoom();
            setWaitingRoom(null);
            setPlayers([]);
            setMode('menu');
          }}]
        );
      }
    },
    onGameStarted: () => {
      handleGameStart();
    },
    onPlayerFinished: () => {},
  });
}

  async function handleCreateRoom() {
    if (!playerName.trim()) {
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
      const { room, player } = await onlineService.createRoom(playerName.trim(), randomLetter);

      setWaitingRoom({
        roomId: room.id,
        roomCode: room.room_code,
        playerId: player.id,
        isHost: true,
        letter: randomLetter,
      });
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de créer la salle');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom() {
    if (!playerName.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer votre nom');
      return;
    }

    if (!roomCode.trim() || roomCode.length !== 4) {
      Alert.alert('Erreur', 'Le code doit contenir 4 caractères');
      return;
    }

    setLoading(true);
    try {
      const { room, player } = await onlineService.joinRoom(roomCode.trim(), playerName.trim());

      setWaitingRoom({
        roomId: room.id,
        roomCode: room.room_code,
        playerId: player.id,
        isHost: false,
        letter: room.letter,
      });
    } catch (error: any) {
      Alert.alert('Erreur', error.message || 'Impossible de rejoindre la salle');
    } finally {
      setLoading(false);
    }
  }

  async function handleStartGame() {
    if (!waitingRoom) return;

    if (players.length < 2) {
      Alert.alert('Attention', 'Attendez qu\'un autre joueur rejoigne la salle');
      return;
    }

    setLoading(true);
    try {
      await onlineService.startGame(waitingRoom.roomId);
      // Game will start via subscription callback
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de démarrer la partie');
      setLoading(false);
    }
  }

  async function handleGameStart() {
    if (!waitingRoom) return;

    try {
      const categories = await getCategories();
      const opponent = players.find(p => p.id !== waitingRoom.playerId);

      startMultiplayerGame(
        waitingRoom.letter,
        categories,
        waitingRoom.isHost,
        opponent?.player_name || 'Adversaire'
      );

      router.push('/online-game');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de charger les catégories');
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
            // ✅ Nettoie côté serveur
            await onlineService.leaveRoom(waitingRoom.roomId, waitingRoom.playerId);
            onlineService.unsubscribeFromRoom();
            onlineService.clearCurrentRoom();
            setWaitingRoom(null);
            setPlayers([]);
            setMode('menu');
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
          <Text style={styles.roomCodeHint}>
            Partagez ce code avec votre adversaire
          </Text>
        </View>

        <View style={styles.letterCard}>
          <Text style={styles.letterLabel}>Lettre de la partie</Text>
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
        </View>

        <View style={styles.buttonContainer}>
          {waitingRoom.isHost && (
            <Button
              title="Lancer la partie"
              onPress={handleStartGame}
              loading={loading}
              disabled={players.length < 2}
            />
          )}
          {!waitingRoom.isHost && players.length >= 2 && (
            <View style={styles.waitingCard}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.waitingText}>
                En attente du lancement par l'hôte...
              </Text>
            </View>
          )}
          <Button
            title="Quitter"
            onPress={handleBack}
            variant="secondary"
          />
        </View>
      </View>
    );
  }

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
            Une salle sera créée avec un code unique.{'\n'}
            Partagez ce code avec un autre joueur pour commencer.
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

  if (mode === 'join') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <UserPlus size={48} color="#007AFF" />
          <Text style={styles.title}>Rejoindre une salle</Text>
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

          <Text style={[styles.label, { marginTop: 20 }]}>Code de la salle</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={roomCode}
            onChangeText={(text) => setRoomCode(text.toUpperCase())}
            placeholder="XXXX"
            maxLength={4}
            autoCapitalize="characters"
          />
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Rejoindre"
            onPress={handleJoinRoom}
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Globe size={48} color="#007AFF" />
        <Text style={styles.title}>Jeu en ligne</Text>
        <Text style={styles.subtitle}>Jouez avec d'autres joueurs</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoText}>
          Créez une salle pour inviter un ami ou rejoignez une salle existante avec un code.
        </Text>
      </View>

      <View style={styles.buttonContainer}>
        <Button
          title="Créer une salle"
          onPress={() => setMode('create')}
        />
        <Button
          title="Rejoindre une salle"
          onPress={() => setMode('join')}
          variant="secondary"
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
  codeInput: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 8,
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
  roomCodeHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
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
  });