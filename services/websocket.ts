// services/websocket.ts - Client WebSocket Robuste pour React Native
import { io, Socket } from 'socket.io-client';

// Configuration du serveur WebSocket
// ⚠️ Sur un appareil physique en dev, 'localhost' pointe vers le téléphone, pas
// vers votre PC. Définissez EXPO_PUBLIC_WS_URL dans .env avec l'IP LAN de votre
// machine, ex: EXPO_PUBLIC_WS_URL=http://192.168.1.20:3000
const WEBSOCKET_URL =
  process.env.EXPO_PUBLIC_WS_URL ||
  (__DEV__
    ? 'http://localhost:3000' // Développement local (émulateur / web)
    : 'https://petit-bac-ws.onrender.com'); // Production (à remplacer par votre URL)

// Types
export interface PlayerInfo {
  playerId: string;
  playerName: string;
  isHost: boolean;
  ready: boolean;
  score: number;
}

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
  // Connexion
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  
  // Room
  onRoomJoined?: (data: { roomId: string; playerId: string; isHost: boolean; playerCount: number }) => void;
  onJoinError?: (data: { message: string; code: string }) => void;
  onPlayersList?: (players: PlayerInfo[]) => void;
  onPlayerJoined?: (data: { playerId: string; playerName: string; isHost: boolean; totalPlayers: number }) => void;
  onPlayerLeft?: (data: { playerId: string; playerName: string }) => void;
  onPlayerDisconnected?: (data: { playerId: string; playerName: string; reason: string }) => void;
  onHostChanged?: (data: { newHostId: string; newHostName: string }) => void;
  
  // Ready
  onPlayerReady?: (data: { playerId: string; ready: boolean; allReady: boolean }) => void;
  
  // Game
  // startedAt/timestamp sont des horloges SERVEUR : elapsed = timestamp - startedAt
  // donne le temps déjà écoulé de la manche, sans dépendre de l'horloge du téléphone.
  onGameStarted?: (data: { letter: string; roundNumber: number; roundId: string; roundDuration: number; startedAt?: number; timestamp: number }) => void;
  onOpponentFinished?: (data: { playerId: string; playerName: string; timestamp: number }) => void;
  onRoundComplete?: (data: { roundNumber: number; reason?: string; timestamp: number }) => void;
  // STOP simultané : émis à TOUS dès qu'un joueur termine/crie STOP
  onRoundStopped?: (data: { stoppedBy: string; stoppedByName: string; reason: string; roundNumber: number; timestamp: number }) => void;

  // Scores
  onScoreSubmitted?: (data: { playerId: string; playerName: string; totalScore: number; roundScore: number; timestamp: number }) => void;
  onAllScoresReady?: (data: { results: GameResult[]; roundNumber: number; stoppedBy?: string; timestamp: number }) => void;
  
  // End game requests
  onEndGameRequested?: (data: { playerId: string; playerName: string; roundId: string; timestamp: number }) => void;
  onEndGameResponse?: (data: { accepted: boolean; responderId: string; timestamp: number }) => void;
  
  // New round
  onNewRound?: (data: { letter: string; roundNumber: number; roundId: string; roundDuration?: number; startedAt?: number; timestamp: number }) => void;
  
  // Game ended
  onGameEnded?: (data: { results: GameResult[]; timestamp: number }) => void;
  
  // Server
  onServerShutdown?: (data: { message: string; timestamp: number }) => void;
}

class WebSocketService {
  private socket: Socket | null = null;
  private currentRoomId: string | null = null;
  private currentPlayerId: string | null = null;
  private currentPlayerName: string | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private callbacks: WebSocketCallbacks = {};
  private isManualDisconnect: boolean = false;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialiser la connexion WebSocket
   */
  connect(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        console.log('🔌 WebSocket déjà connecté');
        resolve(true);
        return;
      }

      console.log('🔌 Connexion au serveur WebSocket:', WEBSOCKET_URL);
      this.isManualDisconnect = false;

      // Éviter deux sockets en parallèle si un connect() précédent a échoué
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
      }

      this.socket = io(WEBSOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        forceNew: true,
      });

      // Timeout de connexion
      this.connectionTimeout = setTimeout(() => {
        if (!this.socket?.connected) {
          console.error('❌ Timeout de connexion WebSocket');
          this.socket?.disconnect();
          reject(new Error('Timeout de connexion'));
        }
      }, 20000);

      this.setupEventListeners(resolve, reject);
    });
  }

  /**
   * Configurer les écouteurs d'événements
   */
  private setupEventListeners(
    resolve?: (value: boolean) => void,
    reject?: (reason: Error) => void
  ) {
    if (!this.socket) return;

    // ===== ÉVÉNEMENTS DE CONNEXION =====

    this.socket.on('connect', () => {
      console.log('✅ WebSocket connecté:', this.socket?.id);
      this.reconnectAttempts = 0;
      this.isManualDisconnect = false;

      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }

      // Démarrer le keep-alive
      this.startKeepAlive();

      // Si on était dans une room, la rejoindre
      if (this.currentRoomId && this.currentPlayerId && this.currentPlayerName) {
        this.joinRoom(
          this.currentRoomId,
          this.currentPlayerId,
          this.currentPlayerName
        );
      }

      this.callbacks.onConnected?.();
      resolve?.(true);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('🔌 WebSocket déconnecté:', reason);
      
      this.stopKeepAlive();

      if (!this.isManualDisconnect) {
        this.callbacks.onDisconnected?.();
        
        // Tentative de reconnexion automatique pour certaines raisons
        if (reason === 'io server disconnect') {
          // Le serveur a déconnecté, on tente de reconnecter
          this.socket?.connect();
        }
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Erreur connexion WebSocket:', error.message);
      this.reconnectAttempts++;

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('❌ Nombre max de tentatives atteint');
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
        this.callbacks.onError?.(new Error('Impossible de se connecter au serveur'));
        reject?.(new Error('Impossible de se connecter au serveur'));
      }
    });

    // ===== ÉVÉNEMENTS DE ROOM =====

    this.socket.on('room-joined', (data) => {
      console.log('✅ Room rejointe:', data);
      this.currentRoomId = data.roomId;
      this.callbacks.onRoomJoined?.(data);
    });

    this.socket.on('join-error', (data) => {
      console.error('❌ Erreur join room:', data);
      this.callbacks.onJoinError?.(data);
    });

    this.socket.on('players-list', (data) => {
      console.log('📋 Liste des joueurs:', data.players.length);
      this.callbacks.onPlayersList?.(data.players);
    });

    this.socket.on('player-joined', (data) => {
      console.log('👤 Joueur a rejoint:', data.playerName);
      this.callbacks.onPlayerJoined?.(data);
    });

    this.socket.on('player-left', (data) => {
      console.log('👋 Joueur a quitté:', data.playerName);
      this.callbacks.onPlayerLeft?.(data);
    });

    this.socket.on('player-disconnected', (data) => {
      console.log('⚠️ Joueur déconnecté:', data.playerName, data.reason);
      this.callbacks.onPlayerDisconnected?.(data);
    });

    this.socket.on('host-changed', (data) => {
      console.log('👑 Nouvel hôte:', data.newHostName);
      this.callbacks.onHostChanged?.(data);
    });

    // ===== ÉVÉNEMENTS DE JEU =====

    this.socket.on('player-ready', (data) => {
      console.log('🎯 Joueur prêt:', data.playerId, data.ready);
      this.callbacks.onPlayerReady?.(data);
    });

    this.socket.on('game-started', (data) => {
      console.log('🎮 Partie démarrée. Lettre:', data.letter);
      this.callbacks.onGameStarted?.(data);
    });

    this.socket.on('opponent-finished', (data) => {
      console.log('🏁 Adversaire terminé:', data.playerName);
      this.callbacks.onOpponentFinished?.(data);
    });

    this.socket.on('round-complete', (data) => {
      console.log('✅ Manche terminée:', data.roundNumber);
      this.callbacks.onRoundComplete?.(data);
    });

    this.socket.on('round-stopped', (data) => {
      console.log('🛑 STOP simultané déclenché par:', data.stoppedByName);
      this.callbacks.onRoundStopped?.(data);
    });

    this.socket.on('score-submitted', (data) => {
      console.log('💯 Score soumis:', data.playerName, data.roundScore);
      this.callbacks.onScoreSubmitted?.(data);
    });

    this.socket.on('all-scores-ready', (data) => {
      console.log('🏆 Tous les scores prêts');
      this.callbacks.onAllScoresReady?.(data);
    });

    this.socket.on('end-game-requested', (data) => {
      console.log('🚩 Demande de fin reçue:', data.playerName);
      this.callbacks.onEndGameRequested?.(data);
    });

    this.socket.on('end-game-response', (data) => {
      console.log('📬 Réponse fin de partie:', data.accepted ? 'Accepté' : 'Refusé');
      this.callbacks.onEndGameResponse?.(data);
    });

    this.socket.on('new-round', (data) => {
      console.log('🔄 Nouvelle manche:', data.roundNumber, data.letter);
      this.callbacks.onNewRound?.(data);
    });

    this.socket.on('game-ended', (data) => {
      console.log('🏆 Partie terminée');
      this.callbacks.onGameEnded?.(data);
    });

    this.socket.on('server-shutdown', (data) => {
      console.log('⚠️ Serveur en cours d\'arrêt:', data.message);
      this.callbacks.onServerShutdown?.(data);
    });

    this.socket.on('error', (data) => {
      console.error('❌ Erreur serveur:', data);
      this.callbacks.onError?.(new Error(data.message || 'Erreur serveur'));
    });

    // Pong (keep-alive)
    this.socket.on('pong', (data) => {
      // Silencieux pour ne pas polluer les logs
    });
  }

  /**
   * Démarrer le keep-alive
   */
  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (this.socket?.connected && this.currentRoomId && this.currentPlayerId) {
        this.socket.emit('ping', {
          roomId: this.currentRoomId,
          playerId: this.currentPlayerId,
        });
      }
    }, 20000); // Toutes les 20 secondes
  }

  /**
   * Arrêter le keep-alive
   */
  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  /**
   * Définir les callbacks (fusion avec les callbacks existants)
   */
  setCallbacks(callbacks: WebSocketCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Réinitialiser tous les callbacks. À appeler au montage d'un écran avant
   * setCallbacks : évite que les handlers d'un écran démonté (closures
   * périmées) continuent de réagir aux événements serveur.
   */
  clearCallbacks() {
    this.callbacks = {};
  }

  /**
   * Rejoindre une room
   */
  joinRoom(roomId: string, playerId: string, playerName: string) {
    if (!this.socket?.connected) {
      console.error('❌ WebSocket non connecté');
      return false;
    }

    console.log(`📥 Rejoindre la room ${roomId} en tant que ${playerName}`);

    this.currentRoomId = roomId;
    this.currentPlayerId = playerId;
    this.currentPlayerName = playerName;

    this.socket.emit('join-room', { roomId, playerId, playerName });
    return true;
  }

  /**
   * Définir le statut prêt
   */
  setReady(ready: boolean) {
    if (!this.socket?.connected || !this.currentRoomId || !this.currentPlayerId) {
      console.error('❌ WebSocket non connecté ou pas dans une room');
      return false;
    }

    console.log(`🎯 Définir prêt: ${ready}`);
    this.socket.emit('set-ready', {
      roomId: this.currentRoomId,
      playerId: this.currentPlayerId,
      ready,
    });
    return true;
  }

  /**
   * Démarrer la partie (hôte uniquement)
   */
  startGame(letter: string, roundDuration: number = 120) {
    if (!this.socket?.connected || !this.currentRoomId) {
      console.error('❌ WebSocket non connecté ou pas dans une room');
      return false;
    }

    console.log(`🎮 Démarrer la partie. Lettre: ${letter}`);
    this.socket.emit('start-game', {
      roomId: this.currentRoomId,
      letter,
      roundDuration,
    });
    return true;
  }

  /**
   * Notifier que le joueur a fini
   */
  notifyFinished(reason: 'manual' | 'timeout' = 'manual') {
    if (!this.socket?.connected || !this.currentRoomId || !this.currentPlayerId) {
      console.error('❌ WebSocket non connecté ou pas dans une room');
      return false;
    }

    console.log(`🏁 Notification: Joueur terminé (${reason})`);
    this.socket.emit('player-finished', {
      roomId: this.currentRoomId,
      playerId: this.currentPlayerId,
      reason,
    });
    return true;
  }

  /**
   * Soumettre le score + les réponses détaillées de la manche
   */
  submitScore(
    score: number,
    validWordsCount: number,
    stoppedEarly: boolean = false,
    results: RoundAnswerResult[] = []
  ) {
    if (!this.socket?.connected || !this.currentRoomId || !this.currentPlayerId) {
      console.error('❌ WebSocket non connecté ou pas dans une room');
      return false;
    }

    console.log(`💯 Soumettre score: ${score} pts, ${validWordsCount} mots valides`);
    this.socket.emit('submit-score', {
      roomId: this.currentRoomId,
      playerId: this.currentPlayerId,
      score,
      validWordsCount,
      stoppedEarly,
      results,
    });
    return true;
  }

  /**
   * Demander la fin de partie
   */
  requestEndGame(roundId: string) {
    if (!this.socket?.connected || !this.currentRoomId || !this.currentPlayerId) {
      console.error('❌ WebSocket non connecté ou pas dans une room');
      return false;
    }

    console.log(`🚩 Demander fin de partie`);
    this.socket.emit('request-end-game', {
      roomId: this.currentRoomId,
      playerId: this.currentPlayerId,
      roundId,
    });
    return true;
  }

  /**
   * Répondre à une demande de fin
   */
  respondEndGame(requesterId: string, accepted: boolean) {
    if (!this.socket?.connected || !this.currentRoomId || !this.currentPlayerId) {
      console.error('❌ WebSocket non connecté ou pas dans une room');
      return false;
    }

    console.log(`📬 Réponse fin de partie: ${accepted ? 'Accepté' : 'Refusé'}`);
    this.socket.emit('respond-end-game', {
      roomId: this.currentRoomId,
      playerId: this.currentPlayerId,
      requesterId,
      accepted,
    });
    return true;
  }

  /**
   * Démarrer une nouvelle manche (hôte uniquement)
   */
  nextRound(letter: string) {
    if (!this.socket?.connected || !this.currentRoomId) {
      console.error('❌ WebSocket non connecté ou pas dans une room');
      return false;
    }

    console.log(`🔄 Nouvelle manche. Lettre: ${letter}`);
    this.socket.emit('next-round', {
      roomId: this.currentRoomId,
      letter,
    });
    return true;
  }

  /**
   * Terminer la partie
   */
  endGame() {
    if (!this.socket?.connected || !this.currentRoomId) {
      return false;
    }

    console.log(`🏆 Terminer la partie`);
    this.socket.emit('end-game', {
      roomId: this.currentRoomId,
    });
    return true;
  }

  /**
   * Quitter la room
   */
  leaveRoom() {
    if (!this.socket?.connected || !this.currentRoomId || !this.currentPlayerId) {
      return;
    }

    console.log(`👋 Quitter la room ${this.currentRoomId}`);
    this.socket.emit('leave-room', {
      roomId: this.currentRoomId,
      playerId: this.currentPlayerId,
    });

    this.currentRoomId = null;
    // On garde currentPlayerId et currentPlayerName pour une éventuelle reconnexion
  }

  /**
   * Déconnecter proprement
   */
  disconnect() {
    if (this.socket) {
      console.log('🔌 Déconnexion WebSocket');
      this.isManualDisconnect = true;
      this.stopKeepAlive();
      this.leaveRoom();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Vérifier si connecté
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Obtenir l'ID de la room actuelle
   */
  getCurrentRoomId(): string | null {
    return this.currentRoomId;
  }

  /**
   * Obtenir l'ID du joueur actuel
   */
  getCurrentPlayerId(): string | null {
    return this.currentPlayerId;
  }

  /**
   * Obtenir le nom du joueur actuel
   */
  getCurrentPlayerName(): string | null {
    return this.currentPlayerName;
  }

  /**
   * Définir l'ID du joueur (pour restauration de session)
   */
  setPlayerInfo(playerId: string, playerName: string) {
    this.currentPlayerId = playerId;
    this.currentPlayerName = playerName;
  }

  /**
   * Synchroniser le temps avec le serveur
   */
  async syncTime(): Promise<number> {
    return new Promise((resolve) => {
      if (!this.socket?.connected) {
        resolve(Date.now());
        return;
      }

      const startTime = Date.now();
      const timeout = setTimeout(() => {
        resolve(Date.now());
      }, 5000);

      this.socket.emit('sync-time', { roomId: this.currentRoomId });
      
      this.socket.once('time-sync', (data) => {
        clearTimeout(timeout);
        const roundTrip = Date.now() - startTime;
        const serverTime = data.serverTime + Math.floor(roundTrip / 2);
        resolve(serverTime);
      });
    });
  }
}

// Export singleton
export const websocketService = new WebSocketService();