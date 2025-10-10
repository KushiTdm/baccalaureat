// services/online.ts
import { supabase } from '../lib/supabase';

export interface GameRoom {
  id: string;
  room_code: string;
  letter: string;
  host_player_name: string; // ✅ Corrigé : correspondance avec SQL
  status: 'waiting' | 'playing' | 'finished'; // ✅ Corrigé : 'playing' au lieu de 'in_progress'
  max_players: number; // ✅ Ajouté
  created_at: string;
  started_at: string | null; // ✅ Ajouté
  finished_at: string | null; // ✅ Ajouté
}

export interface GameRoomPlayer {
  id: string;
  room_id: string;
  player_name: string;
  is_host: boolean;
  is_ready: boolean; // ✅ Ajouté
  score: number; // ✅ Ajouté
  finished_at: string | null; // ✅ Ajouté
  joined_at: string;
}

export interface GameRoomAnswer {
  id: string;
  room_id: string;
  player_id: string;
  categorie_id: number;
  word: string;
  is_valid: boolean;
  points: number;
  submitted_at: string;
}

export interface RoomSubscriptionCallbacks {
  onPlayerJoined: (player: GameRoomPlayer) => void;
  onPlayerLeft: (playerId: string) => void; // ✅ Ajouté
  onGameStarted: () => void;
  onPlayerFinished: (player: GameRoomPlayer) => void; // ✅ Ajouté
  onAnswerSubmitted?: (answer: GameRoomAnswer) => void; // ✅ Ajouté (optionnel)
}

class OnlineService {
  private currentRoomId: string | null = null;
  private currentPlayerId: string | null = null; // ✅ Ajouté pour tracking
  private subscription: any = null;

  // Generate a random 4-character room code
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Create a new game room
  async createRoom(playerName: string, letter: string): Promise<{ room: GameRoom; player: GameRoomPlayer }> {
    const roomCode = this.generateRoomCode();

    const { data: room, error: roomError } = await supabase
      .from('game_rooms')
      .insert({
        room_code: roomCode,
        host_player_name: playerName, // ✅ Corrigé
        letter: letter,
        status: 'waiting', // ✅ Corrigé
      })
      .select()
      .single();

    if (roomError || !room) {
      throw new Error('Impossible de créer la salle');
    }

    const { data: player, error: playerError } = await supabase
      .from('game_room_players')
      .insert({
        room_id: room.id,
        player_name: playerName,
        is_host: true,
      })
      .select()
      .single();

    if (playerError || !player) {
      throw new Error('Impossible de rejoindre la salle');
    }

    this.currentRoomId = room.id;
    this.currentPlayerId = player.id; // ✅ Ajouté
    return { room, player };
  }

  // Join an existing room
  async joinRoom(roomCode: string, playerName: string): Promise<{ room: GameRoom; player: GameRoomPlayer }> {
    const { data: room, error: roomError } = await supabase
      .from('game_rooms')
      .select()
      .eq('room_code', roomCode)
      .eq('status', 'waiting')
      .single();

    if (roomError || !room) {
      throw new Error('Salle introuvable ou déjà commencée');
    }

    const { data: existingPlayers } = await supabase
      .from('game_room_players')
      .select()
      .eq('room_id', room.id);

    if (existingPlayers && existingPlayers.length >= room.max_players) { // ✅ Utilise max_players
      throw new Error('La salle est pleine');
    }

    const { data: player, error: playerError } = await supabase
      .from('game_room_players')
      .insert({
        room_id: room.id,
        player_name: playerName,
        is_host: false,
      })
      .select()
      .single();

    if (playerError || !player) {
      throw new Error('Impossible de rejoindre la salle');
    }

    this.currentRoomId = room.id;
    this.currentPlayerId = player.id; // ✅ Ajouté
    return { room, player };
  }

  // Get all players in a room
  async getPlayers(roomId: string): Promise<GameRoomPlayer[]> {
    const { data, error } = await supabase
      .from('game_room_players')
      .select()
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });

    if (error) {
      throw new Error('Impossible de charger les joueurs');
    }

    return data || [];
  }

  // Get room details
  async getRoom(roomId: string): Promise<GameRoom | null> {
    const { data, error } = await supabase
      .from('game_rooms')
      .select()
      .eq('id', roomId)
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  // ✅ NOUVEAU : Soumettre une réponse
  async submitAnswer(
    roomId: string,
    playerId: string,
    categorieId: number,
    word: string,
    isValid: boolean,
    points: number
  ): Promise<GameRoomAnswer> {
    const { data, error } = await supabase
      .from('game_room_answers')
      .insert({
        room_id: roomId,
        player_id: playerId,
        categorie_id: categorieId,
        word: word,
        is_valid: isValid,
        points: points,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error('Impossible de soumettre la réponse');
    }

    return data;
  }

  // ✅ NOUVEAU : Récupérer les réponses d'un joueur
  async getPlayerAnswers(playerId: string): Promise<GameRoomAnswer[]> {
    const { data, error } = await supabase
      .from('game_room_answers')
      .select()
      .eq('player_id', playerId)
      .order('submitted_at', { ascending: true });

    if (error) {
      throw new Error('Impossible de charger les réponses');
    }

    return data || [];
  }

  // ✅ NOUVEAU : Récupérer toutes les réponses d'une salle
  async getRoomAnswers(roomId: string): Promise<GameRoomAnswer[]> {
    const { data, error } = await supabase
      .from('game_room_answers')
      .select()
      .eq('room_id', roomId)
      .order('submitted_at', { ascending: true });

    if (error) {
      throw new Error('Impossible de charger les réponses');
    }

    return data || [];
  }

  // ✅ NOUVEAU : Marquer un joueur comme ayant terminé
  async finishPlayer(playerId: string, score: number): Promise<void> {
    const { error } = await supabase
      .from('game_room_players')
      .update({
        score: score,
        finished_at: new Date().toISOString(),
      })
      .eq('id', playerId);

    if (error) {
      throw new Error('Impossible de mettre à jour le score');
    }
  }

  // Subscribe to room updates
  subscribeToRoom(roomId: string, callbacks: RoomSubscriptionCallbacks) {
  console.log('🔔 Souscription à la room:', roomId);
  
  // Nettoyer l'ancienne souscription si elle existe
  if (this.subscription) {
    supabase.removeChannel(this.subscription);
  }

  this.subscription = supabase
    .channel(`room:${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'game_room_players',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        console.log('✅ Nouveau joueur détecté:', payload.new);
        callbacks.onPlayerJoined(payload.new as GameRoomPlayer);
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'game_room_players',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        console.log('❌ Joueur parti:', payload.old);
        callbacks.onPlayerLeft((payload.old as GameRoomPlayer).id);
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'game_rooms',
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        console.log('🎮 Mise à jour de la room:', payload.new);
        const room = payload.new as GameRoom;
        if (room.status === 'playing') {
          callbacks.onGameStarted();
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'game_room_players',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        const player = payload.new as GameRoomPlayer;
        if (player.finished_at) {
          console.log('🏁 Joueur a terminé:', player);
          callbacks.onPlayerFinished(player);
        }
      }
    );

  // ✅ Optionnel : écouter les réponses en temps réel
  if (callbacks.onAnswerSubmitted) {
    this.subscription.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'game_room_answers',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        console.log('📝 Nouvelle réponse:', payload.new);
        callbacks.onAnswerSubmitted!(payload.new as GameRoomAnswer);
      }
    );
  }

  // ✅ IMPORTANT : Subscribe APRÈS avoir ajouté tous les listeners
  this.subscription.subscribe((status: string) => {
    console.log('📡 Statut de souscription:', status);
    if (status === 'SUBSCRIBED') {
      console.log('✅ Souscription active pour la room:', roomId);
    } else if (status === 'CHANNEL_ERROR') {
      console.error('❌ Erreur de souscription pour la room:', roomId);
    }
  });
}

  // Unsubscribe from room updates
  unsubscribeFromRoom() {
    if (this.subscription) {
      supabase.removeChannel(this.subscription);
      this.subscription = null;
    }
  }

  // Start the game
  async startGame(roomId: string) {
    const { error } = await supabase
      .from('game_rooms')
      .update({ 
        status: 'playing', // ✅ Corrigé
        started_at: new Date().toISOString(), // ✅ Ajouté
      })
      .eq('id', roomId);

    if (error) {
      throw new Error('Impossible de démarrer la partie');
    }
  }

  // ✅ NOUVEAU : Terminer la partie
  async finishGame(roomId: string) {
    const { error } = await supabase
      .from('game_rooms')
      .update({ 
        status: 'finished',
        finished_at: new Date().toISOString(),
      })
      .eq('id', roomId);

    if (error) {
      throw new Error('Impossible de terminer la partie');
    }
  }

  // Leave room (amélioration avec gestion de l'hôte)
  async leaveRoom(roomId: string, playerId: string) {
    const { data: player } = await supabase
      .from('game_room_players')
      .select('is_host')
      .eq('id', playerId)
      .single();

    // Si l'hôte quitte, supprimer toute la salle
    if (player?.is_host) {
      const { error: roomError } = await supabase
        .from('game_rooms')
        .delete()
        .eq('id', roomId);

      if (roomError) {
        console.error('Error deleting room:', roomError);
      }
    } else {
      // Sinon, juste retirer le joueur
      const { error } = await supabase
        .from('game_room_players')
        .delete()
        .eq('id', playerId);

      if (error) {
        console.error('Error leaving room:', error);
      }
    }
  }

  // ✅ NOUVEAU : Nettoyage des salles abandonnées (à appeler périodiquement)
  async cleanupOldRooms(maxAgeMinutes: number = 30) {
    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - maxAgeMinutes);

    const { error } = await supabase
      .from('game_rooms')
      .delete()
      .eq('status', 'waiting')
      .lt('created_at', cutoffTime.toISOString());

    if (error) {
      console.error('Error cleaning up old rooms:', error);
    }
  }

  // Clear current room
  clearCurrentRoom() {
    this.currentRoomId = null;
    this.currentPlayerId = null; // ✅ Ajouté
  }

  // Get current room ID
  getCurrentRoomId(): string | null {
    return this.currentRoomId;
  }

  // ✅ NOUVEAU : Get current player ID
  getCurrentPlayerId(): string | null {
    return this.currentPlayerId;
  }
}

export const onlineService = new OnlineService();