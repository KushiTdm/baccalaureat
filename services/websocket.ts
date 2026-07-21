// services/websocket.ts - Client temps réel 100% Supabase (plus de serveur
// externe). Transport : Realtime (postgres_changes + presence) pour recevoir
// les événements, Edge Function `game-actions` (clé service_role côté
// serveur) pour les actions qui doivent rester autoritaires : premier STOP
// gagnant, calcul des scores, règle des mots identiques.
//
// L'API publique (méthodes, callbacks, formes de payload) reproduit
// exactement l'ancien client socket.io : aucun changement requis dans
// app/online-setup.tsx, app/online-game.tsx, app/online-results.tsx.
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useSettingsStore } from '../store/settingsStore';

// Réponse détaillée par catégorie (échangée pour l'écran de résultats)
export interface RoundAnswerResult {
  categorieId: number;
  categorieName: string;
  word: string;
  isValid: boolean;
  points: number;
}

export interface GameResult {
  playerId: string;
  playerName: string;
  totalScore: number;
  roundScore: number;
  validWordsCount: number;
  stoppedEarly?: boolean;
  results?: RoundAnswerResult[];
}

export interface WebSocketCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;

  onPlayerJoined?: (data: { playerId: string; playerName: string; isHost: boolean; totalPlayers: number }) => void;
  onPlayerLeft?: (data: { playerId: string; playerName: string }) => void;
  onPlayerDisconnected?: (data: { playerId: string; playerName: string; reason: string }) => void;
  onHostChanged?: (data: { newHostId: string; newHostName: string }) => void;
  // Score cumulé autoritaire (game_room_players.score) mis à jour par le
  // serveur à chaque recalcul (fin de manche, validation manuelle...). Sert
  // de source de vérité pour un badge de score affiché en direct, plutôt
  // qu'une reconstruction locale à partir de l'historique côté client.
  onScoreUpdated?: (data: { playerId: string; playerName: string; score: number }) => void;

  // startedAt/timestamp sont des horloges SERVEUR (colonne created_at) :
  // elapsed = timestamp - startedAt donne le temps déjà écoulé de la
  // manche, sans dépendre de l'horloge du téléphone.
  onGameStarted?: (data: { letter: string; roundNumber: number; roundId: string; roundDuration: number; startedAt?: number; timestamp: number }) => void;
  // STOP simultané : émis à TOUS dès qu'un joueur termine/crie STOP
  onRoundStopped?: (data: { stoppedBy: string; stoppedByName: string; reason: string; roundNumber: number; timestamp: number }) => void;
  onAllScoresReady?: (data: { results: GameResult[]; roundNumber?: number; stoppedBy?: string; timestamp: number }) => void;
  onNewRound?: (data: { letter: string; roundNumber: number; roundId: string; roundDuration?: number; startedAt?: number; timestamp: number }) => void;
  // `results` porte les scores CUMULÉS réels (game_room_players.score) au
  // moment de la fin de partie — source de vérité pour l'écran final, à ne
  // plus reconstruire à partir de l'historique local des manches.
  onGameEnded?: (data: { results: { playerId: string; playerName: string; score: number }[]; timestamp: number }) => void;

  // Validation manuelle par accord mutuel d'un mot absent du dictionnaire.
  // Déclenché à CHAQUE changement : INSERT (vote === null) = nouvelle
  // demande, UPDATE (vote === true/false) = réponse. `playerId` désigne
  // toujours le joueur PROPRIÉTAIRE du mot à valider, jamais le votant.
  onWordValidationVote?: (data: {
    voteId: string;
    playerId: string;
    categorieId: number;
    categorieName?: string;
    word: string;
    vote: boolean | null;
  }) => void;
}

type RoundRow = {
  id: string;
  room_id: string;
  round_number: number;
  letter: string;
  status: 'playing' | 'finished';
  round_duration_sec: number;
  created_at: string;
  stopped_at: string | null;
  stopped_by: string | null;
  stopped_by_name: string | null;
  stopped_reason: string | null;
};

type WordValidationVoteRow = {
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
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reconstruit le classement d'une manche à partir des tables Supabase
 * (lecture seule, RLS publique). Utilisé à la fois pour réagir en direct à
 * une manche qui vient de se terminer et pour le rattrapage à la connexion.
 */
async function fetchRoundResults(roundId: string): Promise<GameResult[]> {
  const { data: round, error: roundError } = await supabase
    .from('game_rounds')
    .select('id, room_id')
    .eq('id', roundId)
    .single();
  if (roundError || !round) throw roundError || new Error('Manche introuvable');

  const [{ data: players, error: playersError }, { data: scores }, { data: answers }] = await Promise.all([
    supabase.from('game_room_players').select('id, player_name, score').eq('room_id', round.room_id),
    supabase.from('game_round_scores').select('player_id, round_score, valid_words_count, stopped_early').eq('round_id', roundId),
    supabase.from('game_room_answers').select('player_id, categorie_id, word, is_valid, points, categories(nom)').eq('round_id', roundId),
  ]);
  if (playersError) throw playersError;

  const scoreByPlayer = new Map((scores || []).map((s) => [s.player_id, s]));
  const answersByPlayer = new Map<string, RoundAnswerResult[]>();
  for (const a of answers || []) {
    if (!answersByPlayer.has(a.player_id)) answersByPlayer.set(a.player_id, []);
    answersByPlayer.get(a.player_id)!.push({
      categorieId: a.categorie_id,
      categorieName: (a as any).categories?.nom || '',
      word: a.word,
      isValid: a.is_valid,
      points: a.points,
    });
  }

  const results: GameResult[] = (players || []).map((p) => {
    const s = scoreByPlayer.get(p.id);
    return {
      playerId: p.id,
      playerName: p.player_name || '',
      totalScore: p.score || 0,
      roundScore: s?.round_score || 0,
      validWordsCount: s?.valid_words_count || 0,
      stoppedEarly: s?.stopped_early || false,
      results: answersByPlayer.get(p.id) || [],
    };
  });

  results.sort((a, b) => b.totalScore - a.totalScore);
  return results;
}

class WebSocketService {
  private channel: RealtimeChannel | null = null;
  private channelReady: Promise<void> | null = null;

  private currentRoomId: string | null = null;   // valeur brute passée à joinRoom (code ou uuid)
  private currentRoomDbId: string | null = null;  // uuid réel de game_rooms, résolu en interne
  private currentRoundId: string | null = null;
  private currentPlayerId: string | null = null;
  private currentPlayerName: string | null = null;

  private callbacks: WebSocketCallbacks = {};

  // Dédoublonnage des événements temps réel (un même événement peut arriver
  // à la fois via la réponse HTTP de l'action et via postgres_changes)
  private handledRoundIds = new Set<string>();
  private handledStops = new Set<string>();
  private handledFinalized = new Set<string>();
  private handledGameEnded = false;
  // Une demande de validation passe légitimement par INSERT (demande) puis
  // UPDATE (réponse) : ce sont deux événements distincts, chacun avec son
  // propre Set de dédoublonnage (sinon l'UPDATE serait ignoré comme "déjà vu").
  private handledValidationInserts = new Set<string>();
  private handledValidationUpdates = new Set<string>();
  private lastKnownHostId: string | null = null;

  /**
   * Conservé pour compatibilité d'API : il n'y a plus de connexion explicite
   * à établir avec Supabase (le client REST/Realtime est toujours "prêt").
   */
  async connect(): Promise<boolean> {
    return true;
  }

  setCallbacks(callbacks: WebSocketCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Réinitialise tous les callbacks. À appeler au montage d'un écran avant
   * setCallbacks : évite que les handlers d'un écran démonté (closures
   * périmées) continuent de réagir aux événements.
   */
  clearCallbacks() {
    this.callbacks = {};
  }

  setPlayerInfo(playerId: string, playerName: string) {
    this.currentPlayerId = playerId;
    this.currentPlayerName = playerName;
  }

  /**
   * Rejoint le canal Realtime de la room (broadcast implicite via
   * postgres_changes + presence). Renvoie une fois le canal réellement
   * SUBSCRIBED (ou `false` si ça échoue) : à AWAITER avant toute action qui
   * suppose le canal prêt (démarrer la manche, naviguer vers l'écran de
   * jeu...). Avant ce correctif, l'appel était fire-and-forget et un joueur
   * pouvait naviguer vers /online-game (voire l'hôte démarrer la manche)
   * alors que le canal Realtime n'était pas encore prêt ou avait échoué en
   * silence — l'un des deux se retrouvait alors seul dans une partie jamais
   * réellement synchronisée avec l'adversaire.
   */
  async joinRoom(roomIdOrCode: string, playerId: string, playerName: string): Promise<boolean> {
    this.currentRoomId = roomIdOrCode;
    this.currentPlayerId = playerId;
    this.currentPlayerName = playerName;

    this.channelReady = this.setupChannel(roomIdOrCode, playerId, playerName);
    try {
      await this.channelReady;
      return true;
    } catch (error) {
      console.error('❌ Impossible de rejoindre la room Supabase Realtime:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  private async resolveRoomDbId(roomIdOrCode: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('game_rooms')
      .select('id')
      .eq(UUID_RE.test(roomIdOrCode) ? 'id' : 'room_code', roomIdOrCode)
      .maybeSingle();
    if (error || !data) return null;
    return data.id;
  }

  private async setupChannel(roomIdOrCode: string, playerId: string, playerName: string): Promise<void> {
    const roomDbId = await this.resolveRoomDbId(roomIdOrCode);
    if (!roomDbId) throw new Error('Room introuvable');
    this.currentRoomDbId = roomDbId;

    if (this.channel) {
      await supabase.removeChannel(this.channel);
      this.channel = null;
    }

    const channel = supabase.channel(`room:${roomDbId}`, {
      config: { presence: { key: playerId } },
    });

    channel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_rounds', filter: `room_id=eq.${roomDbId}` },
        (payload) => this.handleRoundInserted(payload.new as RoundRow)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_rounds', filter: `room_id=eq.${roomDbId}` },
        (payload) => this.handleRoundUpdated(payload.new as RoundRow)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_room_players', filter: `room_id=eq.${roomDbId}` },
        (payload) =>
          this.handlePlayerUpdated(
            payload.new as { id: string; is_host: boolean; player_name: string; score: number }
          )
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomDbId}` },
        (payload) => this.handleRoomUpdated(payload.new as { status: string; id?: string })
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'word_validation_votes', filter: `room_id=eq.${roomDbId}` },
        (payload) => this.handleWordValidationInserted(payload.new as WordValidationVoteRow)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'word_validation_votes', filter: `room_id=eq.${roomDbId}` },
        (payload) => this.handleWordValidationUpdated(payload.new as WordValidationVoteRow)
      )
      .on('presence', { event: 'join' }, ({ key }: { key: string }) => {
        if (key !== playerId) this.callbacks.onPlayerJoined?.({ playerId: key, playerName: '', isHost: false, totalPlayers: 0 });
      })
      .on('presence', { event: 'leave' }, ({ key }: { key: string }) => {
        if (key === playerId) return;
        this.callbacks.onPlayerDisconnected?.({ playerId: key, playerName: '', reason: 'left' });
        // Si l'hôte vient de partir, transférer atomiquement à celui qui reste
        // (les deux clients peuvent appeler ceci en même temps : le RPC ne
        // laisse passer que le premier, cf realtime-multiplayer-migration.sql)
        if (key === this.lastKnownHostId && this.currentRoomDbId) {
          supabase.rpc('transfer_host', { p_room_id: this.currentRoomDbId, p_old_host_id: key }).then(
            ({ data }: { data: any }) => {
              const newHost = Array.isArray(data) ? data[0] : data;
              if (newHost) this.handlePlayerUpdated(newHost);
            }
          );
        }
      });

    this.channel = channel;

    await new Promise<void>((resolve, reject) => {
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({ playerId, playerName });
          } catch {
            // le suivi de présence n'est pas critique, on continue
          }
          this.callbacks.onConnected?.();
          resolve();
          this.catchUp(roomDbId).catch((e) => console.error('Rattrapage échoué:', e));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.callbacks.onDisconnected?.();
          reject(new Error(`Statut du canal temps réel : ${status}`));
        } else if (status === 'CLOSED') {
          this.callbacks.onDisconnected?.();
        }
      });
    });
  }

  /**
   * Synchronise l'état si une manche a démarré/s'est arrêtée/terminée avant
   * que cet abonnement ne soit prêt (équivalent du catch-up de l'ancien
   * serveur socket.io au moment du join-room).
   */
  private async catchUp(roomDbId: string) {
    const { data: hostRow } = await supabase
      .from('game_room_players')
      .select('id')
      .eq('room_id', roomDbId)
      .eq('is_host', true)
      .maybeSingle();
    this.lastKnownHostId = hostRow?.id || null;

    const { data: rounds } = await supabase
      .from('game_rounds')
      .select('*')
      .eq('room_id', roomDbId)
      .order('round_number', { ascending: false })
      .limit(1);

    const round = rounds?.[0] as RoundRow | undefined;
    if (round) {
      this.handleRoundInserted(round);
      if (round.stopped_at || round.status === 'finished') {
        this.handleRoundUpdated(round);
      }
    }

    const { data: room } = await supabase.from('game_rooms').select('status').eq('id', roomDbId).maybeSingle();
    if (room) this.handleRoomUpdated(room);
  }

  private async ensureChannelReady(): Promise<void> {
    if (this.channelReady) {
      await this.channelReady;
    }
  }

  // ---------- Réactions aux changements Postgres ----------

  private handleRoundInserted(round: RoundRow) {
    if (this.handledRoundIds.has(round.id)) return;
    this.handledRoundIds.add(round.id);
    this.currentRoundId = round.id;

    const payload = {
      letter: round.letter,
      roundNumber: round.round_number,
      roundId: round.id,
      roundDuration: round.round_duration_sec,
      startedAt: new Date(round.created_at).getTime(),
      timestamp: Date.now(),
    };

    if (round.round_number === 1) {
      this.callbacks.onGameStarted?.(payload);
    } else {
      this.callbacks.onNewRound?.(payload);
    }
  }

  private handleRoundUpdated(round: RoundRow) {
    this.currentRoundId = round.id;

    if (round.stopped_at && !this.handledStops.has(round.id)) {
      this.handledStops.add(round.id);
      this.callbacks.onRoundStopped?.({
        stoppedBy: round.stopped_by || 'server',
        stoppedByName: round.stopped_by_name || 'Temps écoulé',
        reason: round.stopped_reason || 'timeout',
        roundNumber: round.round_number,
        timestamp: Date.now(),
      });
    }

    if (round.status === 'finished' && !this.handledFinalized.has(round.id)) {
      this.handledFinalized.add(round.id);
      fetchRoundResults(round.id)
        .then((results) => this.callbacks.onAllScoresReady?.({ results, roundNumber: round.round_number, timestamp: Date.now() }))
        .catch((e) => console.error('Impossible de récupérer les résultats de la manche:', e));
    }
  }

  private handlePlayerUpdated(player: { id: string; is_host: boolean; player_name: string; score: number }) {
    if (player.is_host && player.id !== this.lastKnownHostId) {
      const previous = this.lastKnownHostId;
      this.lastKnownHostId = player.id;
      if (previous !== null) {
        this.callbacks.onHostChanged?.({ newHostId: player.id, newHostName: player.player_name });
      }
    }
    if (typeof player.score === 'number') {
      this.callbacks.onScoreUpdated?.({ playerId: player.id, playerName: player.player_name, score: player.score });
    }
  }

  private handleRoomUpdated(room: { status: string; id?: string }) {
    if (room.status === 'finished' && !this.handledGameEnded) {
      this.handledGameEnded = true;
      const roomDbId = room.id || this.currentRoomDbId;
      if (roomDbId) {
        supabase
          .from('game_room_players')
          .select('id, player_name, score')
          .eq('room_id', roomDbId)
          .then(({ data }) => {
            const results = (data || []).map((p) => ({ playerId: p.id, playerName: p.player_name || '', score: p.score || 0 }));
            this.callbacks.onGameEnded?.({ results, timestamp: Date.now() });
          });
      } else {
        this.callbacks.onGameEnded?.({ results: [], timestamp: Date.now() });
      }
    }
  }

  private handleWordValidationInserted(row: WordValidationVoteRow) {
    if (this.handledValidationInserts.has(row.id)) return;
    this.handledValidationInserts.add(row.id);
    this.callbacks.onWordValidationVote?.({
      voteId: row.id,
      playerId: row.player_id,
      categorieId: row.categorie_id,
      word: row.word,
      vote: row.vote,
    });
  }

  private handleWordValidationUpdated(row: WordValidationVoteRow) {
    if (this.handledValidationUpdates.has(row.id)) return;
    this.handledValidationUpdates.add(row.id);
    this.callbacks.onWordValidationVote?.({
      voteId: row.id,
      playerId: row.player_id,
      categorieId: row.categorie_id,
      word: row.word,
      vote: row.vote,
    });
  }

  // ---------- Actions (Edge Function `game-actions`, clé service_role) ----------

  private async invoke(body: Record<string, unknown>): Promise<any> {
    const { data, error } = await supabase.functions.invoke('game-actions', { body });
    if (error) throw error;
    return data;
  }

  /**
   * Démarre la 1re manche (hôte uniquement). Idempotent côté serveur : si
   * l'adversaire n'a pas encore rejoint le canal, il rattrapera l'état via
   * le catch-up dès que sa souscription sera prête (plus besoin d'attendre
   * une "connexion socket" comme avec l'ancien serveur).
   */
  async startGame(letter: string, roundDuration: number = 120): Promise<boolean> {
    try {
      await this.ensureChannelReady();
      if (!this.currentRoomDbId) throw new Error('Room non résolue');
      const data = await this.invoke({
        action: 'start-round',
        roomId: this.currentRoomDbId,
        letter,
        roundDurationSec: roundDuration,
        roundNumber: 1,
      });
      if (data?.round) this.handleRoundInserted(data.round);
      return true;
    } catch (error) {
      console.error('❌ Démarrage de la manche échoué:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Notifie que le joueur a fini / crié STOP. Le premier appel à atteindre
   * la base de données gagne (contrainte "stopped_at IS NULL" côté Edge
   * Function) : c'est ce qui remplace le "premier arrivé" du serveur en
   * mémoire.
   */
  async notifyFinished(reason: 'manual' | 'timeout' = 'manual'): Promise<boolean> {
    try {
      await this.ensureChannelReady();
      if (!this.currentRoundId || !this.currentPlayerId) throw new Error('Manche ou joueur inconnu');
      const data = await this.invoke({
        action: 'player-finished',
        roundId: this.currentRoundId,
        playerId: this.currentPlayerId,
        reason,
      });
      if (data?.round) this.handleRoundUpdated(data.round);
      return true;
    } catch (error) {
      console.error('❌ Notification STOP échouée:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Soumet le score + les réponses détaillées de la manche. L'Edge Function
   * finalise automatiquement (règle des mots identiques comprise) dès que
   * tous les joueurs de la room ont soumis.
   */
  async submitScore(
    score: number,
    validWordsCount: number,
    stoppedEarly: boolean = false,
    results: RoundAnswerResult[] = []
  ): Promise<boolean> {
    try {
      await this.ensureChannelReady();
      if (!this.currentRoundId || !this.currentPlayerId || !this.currentRoomDbId) {
        throw new Error('Manche, joueur ou room inconnu');
      }
      const data = await this.invoke({
        action: 'submit-score',
        roomId: this.currentRoomDbId,
        roundId: this.currentRoundId,
        playerId: this.currentPlayerId,
        score,
        validWordsCount,
        stoppedEarly,
        results,
      });
      if (data?.finalized && data?.results && this.currentRoundId && !this.handledFinalized.has(this.currentRoundId)) {
        this.handledFinalized.add(this.currentRoundId);
        this.callbacks.onAllScoresReady?.({ results: data.results, timestamp: Date.now() });
      }
      return true;
    } catch (error) {
      console.error('❌ Soumission du score échouée:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Démarre la manche suivante (hôte uniquement, appelé après l'écran de
   * résultats). La lettre n'est plus choisie côté client : le serveur la
   * tire lui-même via `game_rooms.used_letters`, ce qui garantit qu'elle ne
   * revient jamais tant que les 20 lettres n'ont pas toutes été jouées,
   * indépendamment de l'état local (historique pas encore "commité", etc.).
   */
  async nextRound(): Promise<boolean> {
    try {
      await this.ensureChannelReady();
      if (!this.currentRoomDbId) throw new Error('Room non résolue');
      const data = await this.invoke({
        action: 'next-round',
        roomId: this.currentRoomDbId,
      });
      if (data?.round) this.handleRoundInserted(data.round);
      return true;
    } catch (error) {
      console.error('❌ Manche suivante échouée:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  async endGame(): Promise<boolean> {
    try {
      await this.ensureChannelReady();
      if (!this.currentRoomDbId) return false;
      await this.invoke({ action: 'end-game', roomId: this.currentRoomDbId });
      return true;
    } catch (error) {
      console.error('❌ Fin de partie échouée:', error);
      return false;
    }
  }

  /**
   * Demande la validation manuelle d'un de mes mots absent du dictionnaire.
   * Idempotent côté serveur (pas de doublon tant que la demande précédente
   * n'a pas encore reçu de vote). L'adversaire est notifié via
   * `onWordValidationVote` (postgres_changes INSERT sur word_validation_votes).
   */
  async requestWordValidation(categorieId: number, categorieName: string, word: string): Promise<boolean> {
    try {
      await this.ensureChannelReady();
      if (!this.currentRoundId || !this.currentPlayerId || !this.currentRoomDbId) {
        throw new Error('Manche, joueur ou room inconnu');
      }
      const data = await this.invoke({
        action: 'request-word-validation',
        roomId: this.currentRoomDbId,
        roundId: this.currentRoundId,
        playerId: this.currentPlayerId,
        categorieId,
        categorieName,
        word,
      });
      if (data?.vote) this.handleWordValidationInserted(data.vote);
      return true;
    } catch (error) {
      console.error('❌ Demande de validation échouée:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Répond à une demande de validation manuelle reçue de l'adversaire. Si
   * approuvé, l'Edge Function corrige les scores (recalcul complet) et
   * soumet le(s) mot(s) validés au gate IA de dictionnaire (clé locale si
   * configurée — voir store/settingsStore.ts).
   */
  async respondWordValidation(voteId: string, approved: boolean): Promise<boolean> {
    try {
      await this.ensureChannelReady();
      const geminiApiKey = useSettingsStore.getState().geminiApiKey || undefined;
      const data = await this.invoke({
        action: 'respond-word-validation',
        voteId,
        approved,
        geminiApiKey,
      });
      if (data?.vote) this.handleWordValidationUpdated(data.vote);
      return true;
    } catch (error) {
      console.error('❌ Réponse de validation échouée:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  disconnect() {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.channelReady = null;
    this.currentRoomId = null;
    this.currentRoomDbId = null;
    this.currentRoundId = null;
    this.handledRoundIds.clear();
    this.handledStops.clear();
    this.handledFinalized.clear();
    this.handledGameEnded = false;
    this.handledValidationInserts.clear();
    this.handledValidationUpdates.clear();
    this.lastKnownHostId = null;
    // currentPlayerId/currentPlayerName conservés pour une éventuelle reconnexion
  }

  getCurrentRoomId(): string | null {
    return this.currentRoomId;
  }

  /** UUID réel de `game_rooms` (résolu en interne depuis le code/uuid passé à joinRoom). */
  getCurrentRoomDbId(): string | null {
    return this.currentRoomDbId;
  }

  getCurrentPlayerId(): string | null {
    return this.currentPlayerId;
  }
}

// Export singleton
export const websocketService = new WebSocketService();
