// services/online.ts - VERSION COMPLÈTE avec système de manches
import { supabase } from '../lib/supabase';

export interface GameRoom {
  id: string;
  room_code: string;
  letter: string;
  host_player_name: string;
  status: 'waiting' | 'playing' | 'finished';
  max_players: number;
  current_round_number: number;
  used_letters: string[];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface GameRoomPlayer {
  id: string;
  room_id: string;
  player_name: string;
  user_id: string | null; 
  is_host: boolean;
  is_ready: boolean;
  ready_for_next_round: boolean; 
  score: number;
  finished_at: string | null;
  joined_at: string;
}

export interface GameRoomAnswer {
  id: string;
  room_id: string;
  player_id: string;
  round_id: string;
  categorie_id: number;
  word: string;
  is_valid: boolean;
  points: number;
  needs_manual_validation: boolean;
  manual_validation_result: boolean | null;
  submitted_at: string;
}

export interface GameRound {
  id: string;
  room_id: string;
  round_number: number;
  letter: string;
  status: 'playing' | 'finished';
  created_at: string;
  finished_at: string | null;
}

export interface GameRoundScore {
  id: string;
  round_id: string;
  player_id: string;
  round_score: number;
  valid_words_count: number;
  stopped_early: boolean;
  penalty_applied: boolean;
  finished_at: string | null;
}

export interface EndGameRequest {
  id: string;
  room_id: string;
  round_id: string;
  requester_player_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  responded_at: string | null;
}

export interface WordValidationVote {
  id: string;
  room_id: string;
  round_id: string;
  answer_id: string;
  word: string;
  categorie_id: number;
  player_id: string;
  vote: boolean | null;
  created_at: string;
  voted_at: string | null;
}

export interface RoomSubscriptionCallbacks {
  onPlayerJoined: (player: GameRoomPlayer) => void;
  onPlayerLeft: (playerId: string) => void;
  onGameStarted: () => void;
  onPlayerFinished: (player: GameRoomPlayer) => void;
  onAnswerSubmitted?: (answer: GameRoomAnswer) => void;
  onEndGameRequestReceived?: (request: EndGameRequest) => void;
  onEndGameRequestResponded?: (request: EndGameRequest) => void;
  onWordValidationVoted?: (vote: WordValidationVote) => void;
  onRoundFinished?: (round: GameRound) => void;
}

class OnlineService {
  private currentRoomId: string | null = null;
  private currentPlayerId: string | null = null;
  private currentRoundId: string | null = null;
  private subscription: any = null;

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async createRoom(playerName: string, letter: string): Promise<{ room: GameRoom; player: GameRoomPlayer }> {
    const roomCode = this.generateRoomCode();

    const { data: room, error: roomError } = await supabase
      .from('game_rooms')
      .insert({
        room_code: roomCode,
        host_player_name: playerName,
        letter: letter,
        status: 'waiting',
        current_round_number: 1,
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
    this.currentPlayerId = player.id;
    return { room, player };
  }

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

    if (existingPlayers && existingPlayers.length >= room.max_players) {
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
    this.currentPlayerId = player.id;
    return { room, player };
  }

  async getNextLetter(roomId: string): Promise<string> {
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    
    // Récupérer la room pour voir les lettres déjà utilisées
    const room = await this.getRoom(roomId);
    if (!room) throw new Error('Room introuvable');

    const usedLetters = room.used_letters || [];
    const availableLetters = LETTERS.filter(l => !usedLetters.includes(l));

    // Si toutes les lettres ont été utilisées, réinitialiser
    if (availableLetters.length === 0) {
      console.log('🔄 Toutes les lettres utilisées, réinitialisation');
      await supabase
        .from('game_rooms')
        .update({ used_letters: [] })
        .eq('id', roomId);
      
      // Choisir une lettre aléatoire parmi toutes
      return LETTERS[Math.floor(Math.random() * LETTERS.length)];
    }

    // Choisir une lettre aléatoire parmi les disponibles
    const newLetter = availableLetters[Math.floor(Math.random() * availableLetters.length)];
    
    // Ajouter la lettre aux lettres utilisées
    const updatedUsedLetters = [...usedLetters, newLetter];
    await supabase
      .from('game_rooms')
      .update({ used_letters: updatedUsedLetters })
      .eq('id', roomId);

    console.log('🔤 New letter:', newLetter, '| Used:', updatedUsedLetters.length, '/', LETTERS.length);
    
    return newLetter;
  }

  async setPlayerReady(playerId: string, ready: boolean): Promise<void> {
    const { error } = await supabase
      .from('game_room_players')
      .update({ ready_for_next_round: ready })
      .eq('id', playerId);

    if (error) {
      throw new Error('Impossible de mettre à jour le statut ready');
    }
}

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

  // ===== GESTION DES MANCHES =====

  async createRound(roomId: string, roundNumber: number, letter: string): Promise<GameRound> {
    const { data, error } = await supabase
      .from('game_rounds')
      .insert({
        room_id: roomId,
        round_number: roundNumber,
        letter: letter,
        status: 'playing',
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error('Impossible de créer la manche');
    }

    this.currentRoundId = data.id;
    return data;
  }

  async getCurrentRound(roomId: string): Promise<GameRound | null> {
    const { data, error } = await supabase
      .from('game_rounds')
      .select()
      .eq('room_id', roomId)
      .eq('status', 'playing')
      .order('round_number', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return null;
    }

    if (data) {
      this.currentRoundId = data.id;
    }

    return data;
  }

  async finishRound(roundId: string): Promise<void> {
    const { error } = await supabase
      .from('game_rounds')
      .update({
        status: 'finished',
        finished_at: new Date().toISOString(),
      })
      .eq('id', roundId);

    if (error) {
      throw new Error('Impossible de terminer la manche');
    }
  }

  async submitRoundScore(
    roundId: string,
    playerId: string,
    roundScore: number,
    validWordsCount: number,
    stoppedEarly: boolean,
    penaltyApplied: boolean
  ): Promise<void> {
    // 1. Insérer le score de la manche
    const { error: scoreError } = await supabase
      .from('game_round_scores')
      .insert({
        round_id: roundId,
        player_id: playerId,
        round_score: roundScore,
        valid_words_count: validWordsCount,
        stopped_early: stoppedEarly,
        penalty_applied: penaltyApplied,
        finished_at: new Date().toISOString(),
      });

    if (scoreError) {
      throw new Error('Impossible de soumettre le score de manche');
    }

    // 2. Mettre à jour le statut du joueur pour notifier l'adversaire via Realtime
    await supabase
      .from('game_room_players')
      .update({ 
        finished_at: new Date().toISOString(),
        score: roundScore // Optionnel, mais utile pour le suivi
      })
      .eq('id', playerId);
  }

  async getRoundScores(roundId: string): Promise<GameRoundScore[]> {
    const { data, error } = await supabase
      .from('game_round_scores')
      .select()
      .eq('round_id', roundId);

    if (error) {
      throw new Error('Impossible de charger les scores de manche');
    }

    return data || [];
  }

  async getAllRoundsForRoom(roomId: string): Promise<GameRound[]> {
    const { data, error } = await supabase
      .from('game_rounds')
      .select()
      .eq('room_id', roomId)
      .order('round_number', { ascending: true });

    if (error) {
      throw new Error('Impossible de charger les manches');
    }

    return data || [];
  }

  // ===== GESTION DES RÉPONSES =====

  async submitAnswer(
    roomId: string,
    playerId: string,
    roundId: string,
    categorieId: number,
    word: string,
    isValid: boolean,
    points: number,
    needsManualValidation: boolean = false
  ): Promise<GameRoomAnswer> {
    const { data, error } = await supabase
      .from('game_room_answers')
      .insert({
        room_id: roomId,
        player_id: playerId,
        round_id: roundId,
        categorie_id: categorieId,
        word: word,
        is_valid: isValid,
        points: points,
        needs_manual_validation: needsManualValidation,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error('Impossible de soumettre la réponse');
    }

    return data;
  }

  async getRoundAnswers(roundId: string): Promise<GameRoomAnswer[]> {
    const { data, error } = await supabase
      .from('game_room_answers')
      .select()
      .eq('round_id', roundId)
      .order('submitted_at', { ascending: true });

    if (error) {
      throw new Error('Impossible de charger les réponses');
    }

    return data || [];
  }

  async getPlayerRoundAnswers(playerId: string, roundId: string): Promise<GameRoomAnswer[]> {
    const { data, error } = await supabase
      .from('game_room_answers')
      .select()
      .eq('player_id', playerId)
      .eq('round_id', roundId)
      .order('submitted_at', { ascending: true });

    if (error) {
      throw new Error('Impossible de charger les réponses');
    }

    return data || [];
  }

  // ===== DEMANDES DE FIN DE PARTIE =====

  async requestEndGame(roomId: string, roundId: string, requesterId: string): Promise<EndGameRequest> {
    const { data, error } = await supabase
      .from('end_game_requests')
      .insert({
        room_id: roomId,
        round_id: roundId,
        requester_player_id: requesterId,
        status: 'pending',
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error('Impossible d\'envoyer la demande');
    }

    return data;
  }

  async respondToEndGameRequest(requestId: string, accept: boolean): Promise<void> {
    const { error } = await supabase
      .from('end_game_requests')
      .update({
        status: accept ? 'accepted' : 'rejected',
        responded_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (error) {
      throw new Error('Impossible de répondre à la demande');
    }
  }

  async getPendingEndGameRequest(roomId: string, roundId: string): Promise<EndGameRequest | null> {
    const { data, error } = await supabase
      .from('end_game_requests')
      .select()
      .eq('room_id', roomId)
      .eq('round_id', roundId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return null;
    }

    return data;
  }

  // ===== VALIDATION MANUELLE DE MOTS =====

  async createWordValidationVote(
    roomId: string,
    roundId: string,
    answerId: string,
    word: string,
    categorieId: number,
    players: GameRoomPlayer[]
  ): Promise<void> {
    const votes = players.map(player => ({
      room_id: roomId,
      round_id: roundId,
      answer_id: answerId,
      word: word,
      categorie_id: categorieId,
      player_id: player.id,
      vote: null,
    }));

    const { error } = await supabase
      .from('word_validation_votes')
      .insert(votes);

    if (error) {
      throw new Error('Impossible de créer les votes');
    }
  }

  async voteForWordValidation(voteId: string, playerId: string, isValid: boolean): Promise<void> {
    console.log('🗳️ Recording vote:', voteId, 'playerId:', playerId, 'isValid:', isValid);
    
    const { data: before } = await supabase
      .from('word_validation_votes')
      .select('*')
      .eq('id', voteId)
      .single();

    console.log('📋 Vote before update:', before);

    const { data, error } = await supabase
      .from('word_validation_votes')
      .update({
        vote: isValid,
        voted_at: new Date().toISOString(),
      })
      .eq('id', voteId)
      .eq('player_id', playerId)
      .select()
      .single();

    if (error) {
      console.error('❌ Error recording vote:', error);
      throw new Error('Impossible d\'enregistrer le vote: ' + error.message);
    }

    console.log('✅ Vote recorded successfully:', data);
  }

  async getWordValidationVotes(answerId: string): Promise<WordValidationVote[]> {
    const { data, error } = await supabase
      .from('word_validation_votes')
      .select()
      .eq('answer_id', answerId);

    if (error) {
      throw new Error('Impossible de charger les votes');
    }

    return data || [];
  }

  async updateAnswerWithManualValidation(answerId: string, isValid: boolean, points: number): Promise<void> {
  console.log('🔧 Updating answer:', answerId, 'isValid:', isValid, 'points:', points);
  
  const { data: before, error: fetchError } = await supabase
    .from('game_room_answers')
    .select('*')
    .eq('id', answerId)
    .single();

  if (fetchError) {
    console.error('❌ Error fetching answer before update:', fetchError);
    throw new Error('Impossible de récupérer la réponse');
  }

  console.log('📋 Answer before update:', before);

  const { data, error } = await supabase
    .from('game_room_answers')
    .update({
      manual_validation_result: isValid,
      is_valid: isValid,
      points: points,
    })
    .eq('id', answerId)
    .select()
    .single();

  if (error) {
    console.error('❌ Error updating answer:', error);
    throw new Error('Impossible de mettre à jour la réponse: ' + error.message);
  }

  console.log('✅ Answer updated successfully:', data);
}

  // ===== SOUSCRIPTIONS =====

  subscribeToRoom(roomId: string, callbacks: RoomSubscriptionCallbacks) {
    console.log('🔔 Souscription à la room:', roomId);
    
    if (this.subscription) {
      supabase.removeChannel(this.subscription);
    }

    this.subscription = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_room_players', filter: `room_id=eq.${roomId}` },
        (payload: any) => callbacks.onPlayerJoined(payload.new as GameRoomPlayer))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'game_room_players', filter: `room_id=eq.${roomId}` },
        (payload: any) => callbacks.onPlayerLeft((payload.old as GameRoomPlayer).id))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` },
        (payload: any) => {
          const room = payload.new as GameRoom;
          if (room.status === 'playing') callbacks.onGameStarted();
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_room_players', filter: `room_id=eq.${roomId}` },
        (payload: any) => {
          const player = payload.new as GameRoomPlayer;
          if (player.finished_at) callbacks.onPlayerFinished(player);
        });

    if (callbacks.onAnswerSubmitted) {
      this.subscription.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_room_answers', filter: `room_id=eq.${roomId}` },
        (payload: any) => callbacks.onAnswerSubmitted!(payload.new as GameRoomAnswer));
    }

    if (callbacks.onEndGameRequestReceived) {
      this.subscription.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'end_game_requests', filter: `room_id=eq.${roomId}` },
        (payload: any) => callbacks.onEndGameRequestReceived!(payload.new as EndGameRequest));
    }

    if (callbacks.onEndGameRequestResponded) {
      this.subscription.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'end_game_requests', filter: `room_id=eq.${roomId}` },
        (payload: any) => callbacks.onEndGameRequestResponded!(payload.new as EndGameRequest));
    }

    if (callbacks.onWordValidationVoted) {
      this.subscription.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'word_validation_votes', filter: `room_id=eq.${roomId}` },
        (payload: any) => callbacks.onWordValidationVoted!(payload.new as WordValidationVote));
    }

    if (callbacks.onRoundFinished) {
      this.subscription.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_rounds', filter: `room_id=eq.${roomId}` },
        (payload: any) => {
          const round = payload.new as GameRound;
          if (round.status === 'finished') callbacks.onRoundFinished!(round);
        });
    }

    this.subscription.subscribe();
  }

  unsubscribeFromRoom() {
    if (this.subscription) {
      supabase.removeChannel(this.subscription);
      this.subscription = null;
    }
  }

  async startGame(roomId: string) {
    const { error } = await supabase
      .from('game_rooms')
      .update({ 
        status: 'playing',
        started_at: new Date().toISOString(),
      })
      .eq('id', roomId);

    if (error) {
      throw new Error('Impossible de démarrer la partie');
    }
  }

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

  async leaveRoom(roomId: string, playerId: string) {
    const { data: player } = await supabase
      .from('game_room_players')
      .select('is_host')
      .eq('id', playerId)
      .single();

    if (player?.is_host) {
      await supabase.from('game_rooms').delete().eq('id', roomId);
    } else {
      await supabase.from('game_room_players').delete().eq('id', playerId);
    }
  }

  clearCurrentRoom() {
    this.currentRoomId = null;
    this.currentPlayerId = null;
    this.currentRoundId = null;
  }

  getCurrentRoomId(): string | null {
    return this.currentRoomId;
  }

  getCurrentPlayerId(): string | null {
    return this.currentPlayerId;
  }

  getCurrentRoundId(): string | null {
    return this.currentRoundId;
  }

  setCurrentRoundId(roundId: string) {
    this.currentRoundId = roundId;
  }
}

export const onlineService = new OnlineService();