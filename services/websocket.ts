// services/websocket.ts - Client WebSocket pour React Native
import { io, Socket } from 'socket.io-client';

// ✅ CHANGEZ CETTE URL PAR VOTRE URL DE DÉPLOIEMENT
const WEBSOCKET_URL = __DEV__ 
  ? 'http://localhost:3000'  // Développement local
  : 'https://votre-app.onrender.com'; // Production (à remplacer)

export interface WebSocketCallbacks {
  onOpponentFinished?: (data: { playerId: string; playerName: string; timestamp: number }) => void;
  onPlayerJoined?: (data: { playerId: string; playerName: string; totalPlayers: number }) => void;
  onPlayerLeft?: (data: { playerId: string; playerName: string }) => void;
  onAllScoresSubmitted?: (data: { roomId: string; timestamp: number }) => void;
  onEndGameRequested?: (data: { playerId: string; playerName: string; timestamp: number }) => void;
  onEndGameResponse?: (data: { accepted: boolean; timestamp: number }) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
}

class WebSocketService {
  private socket: Socket | null = null;
  private currentRoomId: string | null = null;
  private currentPlayerId: string | null = null;
  private currentPlayerName: string | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private callbacks: WebSocketCallbacks = {};

  /**
   * Initialiser la connexion WebSocket
   */
  connect() {
    if (this.socket?.connected) {
      console.log('🔌 WebSocket déjà connecté');
      return;
    }

    console.log('🔌 Connexion au serveur WebSocket:', WEBSOCKET_URL);

    this.socket = io(WEBSOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    this.setupEventListeners();
  }

  /**
   * Configurer les écouteurs d'événements
   */
  private setupEventListeners() {
    if (!this.socket) return;

    // Connexion réussie
    this.socket.on('connect', () => {
      console.log('✅ WebSocket connecté:', this.socket?.id);
      this.reconnectAttempts = 0;
      
      // Si on était dans une room, la rejoindre
      if (this.currentRoomId && this.currentPlayerId && this.currentPlayerName) {
        this.joinRoom(this.currentRoomId, this.currentPlayerId, this.currentPlayerName);
      }
      
      this.callbacks.onConnected?.();
    });

    // Déconnexion
    this.socket.on('disconnect', (reason) => {
      console.log('🔌 WebSocket déconnecté:', reason);
      this.callbacks.onDisconnected?.();
    });

    // Erreur de connexion
    this.socket.on('connect_error', (error) => {
      console.error('❌ Erreur connexion WebSocket:', error.message);
      this.reconnectAttempts++;
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('❌ Nombre max de tentatives atteint');
        this.callbacks.onError?.(new Error('Impossible de se connecter au serveur'));
      }
    });

    // Événements du jeu
    this.socket.on('opponent-finished', (data) => {
      console.log('🏁 REÇU: Adversaire a terminé:', data);
      console.log('   playerId:', data.playerId);
      console.log('   playerName:', data.playerName);
      this.callbacks.onOpponentFinished?.(data);
    });

    this.socket.on('player-joined', (data) => {
      console.log('👤 Joueur a rejoint:', data);
      this.callbacks.onPlayerJoined?.(data);
    });

    this.socket.on('player-left', (data) => {
      console.log('👋 Joueur a quitté:', data);
      this.callbacks.onPlayerLeft?.(data);
    });

    this.socket.on('all-scores-submitted', (data) => {
      console.log('💯 Tous les scores soumis:', data);
      this.callbacks.onAllScoresSubmitted?.(data);
    });

    this.socket.on('end-game-requested', (data) => {
      console.log('🚩 Demande de fin reçue:', data);
      this.callbacks.onEndGameRequested?.(data);
    });

    this.socket.on('end-game-response', (data) => {
      console.log('📬 Réponse demande de fin:', data);
      this.callbacks.onEndGameResponse?.(data);
    });

    // Pong (keep-alive)
    this.socket.on('pong', (data) => {
      console.log('🏓 Pong reçu:', data.timestamp);
    });
  }

  /**
   * Définir les callbacks
   */
  setCallbacks(callbacks: WebSocketCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Rejoindre une room
   */
  joinRoom(roomId: string, playerId: string, playerName: string) {
    if (!this.socket?.connected) {
      console.error('❌ WebSocket non connecté');
      return;
    }

    console.log(`📥 Rejoindre la room ${roomId} en tant que ${playerName}`);
    
    this.currentRoomId = roomId;
    this.currentPlayerId = playerId;
    this.currentPlayerName = playerName;

    this.socket.emit('join-room', { roomId, playerId, playerName });
  }

  /**
   * Notifier que le joueur a fini
   */
  notifyFinished(roomId: string, playerId: string, playerName: string) {
    if (!this.socket?.connected) {
      console.error('❌ WebSocket non connecté');
      return;
    }

    console.log(`🏁 Notification: ${playerName} a terminé`);
    this.socket.emit('player-finished', { roomId, playerId, playerName });
  }

  /**
   * Notifier qu'un score a été soumis
   */
  notifyScoreSubmitted(roomId: string, playerId: string, playerName: string, score: number) {
    if (!this.socket?.connected) {
      console.error('❌ WebSocket non connecté');
      return;
    }

    console.log(`💯 Score soumis: ${score} points`);
    this.socket.emit('score-submitted', { roomId, playerId, playerName, score });
  }

  /**
   * Demander la fin de partie
   */
  requestEndGame(roomId: string, playerId: string, playerName: string) {
    if (!this.socket?.connected) {
      console.error('❌ WebSocket non connecté');
      return;
    }

    console.log(`🚩 Demande de fin de partie`);
    this.socket.emit('request-end-game', { roomId, playerId, playerName });
  }

  /**
   * Répondre à une demande de fin
   */
  respondEndGame(roomId: string, requesterId: string, accepted: boolean) {
    if (!this.socket?.connected) {
      console.error('❌ WebSocket non connecté');
      return;
    }

    console.log(`📬 Réponse: ${accepted ? 'Accepté' : 'Refusé'}`);
    this.socket.emit('respond-end-game', { roomId, requesterId, accepted });
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
      playerId: this.currentPlayerId 
    });

    this.currentRoomId = null;
    this.currentPlayerId = null;
    this.currentPlayerName = null;
  }

  /**
   * Envoyer un ping (keep-alive)
   */
  ping() {
    if (!this.socket?.connected || !this.currentRoomId || !this.currentPlayerId) {
      return;
    }

    this.socket.emit('ping', { 
      roomId: this.currentRoomId, 
      playerId: this.currentPlayerId 
    });
  }

  /**
   * Déconnecter proprement
   */
  disconnect() {
    if (this.socket) {
      console.log('🔌 Déconnexion WebSocket');
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
}

// Export singleton
export const websocketService = new WebSocketService();