// server.js - Serveur WebSocket Robuste pour Petit Bac
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ===== STRUCTURES DE DONNÉES =====

// Rooms actives: Map<roomId, RoomState>
const rooms = new Map();

// Mapping playerId -> socketId
const playerSockets = new Map();

// Mapping socketId -> playerId
const socketPlayers = new Map();

// Mapping socketId -> roomId
const socketRooms = new Map();

// États possibles d'une room
const ROOM_STATUS = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  FINISHED: 'finished',
  ROUND_END: 'round_end'
};

// Structure d'une room
function createRoomState(roomId) {
  return {
    id: roomId,
    status: ROOM_STATUS.WAITING,
    players: new Map(), // playerId -> { socketId, playerName, score, isHost, finishedAt, ready }
    pendingStart: null, // { letter, roundDuration } si start-game reçu avant que tous soient connectés
    currentRound: {
      id: null,
      number: 1,
      letter: null,
      startedAt: null,
      active: false,            // true tant que la manche accepte des réponses
      stoppedBy: null,          // playerId du premier à crier STOP (ou timeout)
      stoppedReason: null,      // 'manual' | 'timeout'
      finalized: false,         // true une fois 'all-scores-ready' émis
      scoreTimeout: null,       // handle du timeout de collecte des scores
      roundTimeout: null,       // handle du timeout de fin de manche (filet serveur)
      finishedPlayers: new Set(), // Set de playerIds
      scores: new Map(), // playerId -> { score, validWordsCount, stoppedEarly, results }
    },
    gameConfig: {
      roundDuration: 120, // secondes
      maxRounds: 3,
    },
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
}

// ===== ROUTES HTTP =====

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    rooms: rooms.size,
    connections: io.engine.clientsCount,
    activePlayers: playerSockets.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    id: room.id,
    status: room.status,
    playerCount: room.players.size,
    players: Array.from(room.players.values()).map(p => ({
      playerName: p.playerName,
      isHost: p.isHost,
      ready: p.ready
    })),
    currentRound: room.currentRound.number
  });
});

// ===== FONCTIONS UTILITAIRES =====

function log(roomId, message, data = null) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  const logMsg = `[${timestamp}][${roomId?.slice(0, 8) || 'NO-ROOM'}] ${message}`;
  if (data) {
    console.log(logMsg, JSON.stringify(data));
  } else {
    console.log(logMsg);
  }
}

function emitToRoom(roomId, event, data) {
  io.to(roomId).emit(event, data);
  log(roomId, `📢 Emitted ${event}`, data);
}

function emitToPlayer(playerId, event, data) {
  const socketId = playerSockets.get(playerId);
  if (socketId) {
    io.to(socketId).emit(event, data);
    log(null, `📧 Sent ${event} to player ${playerId.slice(0, 8)}`);
  }
}

function getOtherPlayers(room, excludePlayerId) {
  return Array.from(room.players.entries())
    .filter(([id]) => id !== excludePlayerId)
    .map(([id, data]) => ({ playerId: id, ...data }));
}

function clearRoundTimers(room) {
  const cr = room.currentRound;
  if (cr.scoreTimeout) {
    clearTimeout(cr.scoreTimeout);
    cr.scoreTimeout = null;
  }
  if (cr.roundTimeout) {
    clearTimeout(cr.roundTimeout);
    cr.roundTimeout = null;
  }
}

/**
 * Démarre une manche (1re manche ou suivante). Source de vérité unique :
 * startedAt + roundDuration permettent aux clients de calculer le temps
 * restant réel, même en cas de catch-up tardif. Un filet serveur stoppe
 * la manche si aucun client n'a déclenché le timeout.
 */
function startRound(roomId, { letter, roundDuration, roundNumber }) {
  const room = rooms.get(roomId);
  if (!room) return;

  clearRoundTimers(room);

  if (roundDuration) {
    room.gameConfig.roundDuration = roundDuration;
  }

  room.status = ROOM_STATUS.PLAYING;
  room.pendingStart = null;
  room.currentRound = {
    id: `round-${Date.now()}`,
    number: roundNumber,
    letter,
    startedAt: Date.now(),
    active: true,
    stoppedBy: null,
    stoppedReason: null,
    finalized: false,
    scoreTimeout: null,
    roundTimeout: null,
    finishedPlayers: new Set(),
    scores: new Map(),
  };

  room.players.forEach(p => {
    p.finishedAt = null;
    p.ready = false;
  });

  room.lastActivity = Date.now();

  const event = roundNumber === 1 ? 'game-started' : 'new-round';
  emitToRoom(roomId, event, {
    letter,
    roundNumber,
    roundId: room.currentRound.id,
    roundDuration: room.gameConfig.roundDuration,
    startedAt: room.currentRound.startedAt,
    timestamp: Date.now(),
  });

  // Filet serveur : si aucun client ne signale le timeout (déconnexions,
  // horloges décalées), le serveur fige la manche lui-même (+2s de grâce).
  const safetyMs = room.gameConfig.roundDuration * 1000 + 2000;
  room.currentRound.roundTimeout = setTimeout(() => {
    log(roomId, '⏰ Timeout serveur de fin de manche');
    stopRound(roomId, null, 'timeout');
  }, safetyMs);

  log(roomId, `🎮 Manche ${roundNumber} démarrée. Lettre: ${letter}, durée: ${room.gameConfig.roundDuration}s`);
}

/**
 * Fige la manche pour tout le monde (premier STOP, timeout client ou filet
 * serveur). Idempotent : seul le premier appel émet 'round-stopped'.
 */
function stopRound(roomId, stoppedByPlayerId, reason) {
  const room = rooms.get(roomId);
  if (!room) return;

  const cr = room.currentRound;
  if (cr.stoppedBy || cr.finalized || !cr.active) return;

  const stopper = stoppedByPlayerId ? room.players.get(stoppedByPlayerId) : null;
  cr.stoppedBy = stoppedByPlayerId || 'server';
  cr.stoppedReason = reason;

  if (cr.roundTimeout) {
    clearTimeout(cr.roundTimeout);
    cr.roundTimeout = null;
  }

  emitToRoom(roomId, 'round-stopped', {
    stoppedBy: cr.stoppedBy,
    stoppedByName: stopper?.playerName || 'Temps écoulé',
    reason,
    roundNumber: cr.number,
    timestamp: Date.now(),
  });

  log(roomId, `🛑 STOP (${reason}) par ${stopper?.playerName || 'serveur'} → manche figée pour tous`);

  // Filet de sécurité : si un joueur ne renvoie jamais son score
  // (déconnexion, validation bloquée), on finalise quand même.
  cr.scoreTimeout = setTimeout(() => {
    log(roomId, '⏰ Timeout collecte des scores → finalisation forcée');
    finalizeRound(roomId);
  }, 20000);
}

/**
 * Compte les joueurs encore connectés (socket actif) dans la room.
 */
function countConnectedPlayers(room) {
  let count = 0;
  for (const [playerId] of room.players) {
    if (playerSockets.has(playerId)) count++;
  }
  return count;
}

/**
 * Finalise la manche dès que tous les joueurs ENCORE CONNECTÉS ont soumis
 * (un déconnecté ne doit pas bloquer les autres pendant 20s).
 */
function maybeFinalizeRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const cr = room.currentRound;
  if (cr.finalized || !cr.stoppedBy) return;

  const connected = countConnectedPlayers(room);
  if (cr.scores.size >= room.players.size || (connected > 0 && cr.scores.size >= connected)) {
    log(roomId, `✅ Scores complets (${cr.scores.size} reçus, ${connected} connectés)`);
    finalizeRound(roomId);
  }
}

/**
 * Finalise la manche : construit le classement à partir des scores reçus
 * et émet 'all-scores-ready' UNE SEULE FOIS. Les joueurs qui n'ont pas
 * soumis (déconnexion / timeout) reçoivent un score de manche de 0.
 */
function finalizeRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const cr = room.currentRound;
  if (cr.finalized) return; // idempotent
  cr.finalized = true;
  cr.active = false;

  clearRoundTimers(room);

  const results = Array.from(room.players.entries()).map(([id, data]) => {
    const s = cr.scores.get(id);
    return {
      playerId: id,
      playerName: data.playerName,
      totalScore: data.score || 0,
      roundScore: s?.score || 0,
      validWordsCount: s?.validWordsCount || 0,
      stoppedEarly: s?.stoppedEarly || false,
      results: s?.results || [],
    };
  });

  results.sort((a, b) => b.totalScore - a.totalScore);

  room.status = ROOM_STATUS.ROUND_END;

  emitToRoom(roomId, 'all-scores-ready', {
    results,
    roundNumber: cr.number,
    stoppedBy: cr.stoppedBy,
    timestamp: Date.now(),
  });

  log(roomId, `🏁 Manche ${cr.number} finalisée (${cr.scores.size}/${room.players.size} scores)`);
}

// ===== GESTION DES ÉVÉNEMENTS SOCKET =====

io.on('connection', (socket) => {
  console.log(`🔌 Client connecté: ${socket.id}`);

  // ----- REJOINDRE UNE ROOM -----
  socket.on('join-room', ({ roomId, playerId, playerName }) => {
    log(roomId, `👤 ${playerName} tente de rejoindre`, { playerId });

    // Créer la room si elle n'existe pas
    if (!rooms.has(roomId)) {
      rooms.set(roomId, createRoomState(roomId));
      log(roomId, '🆕 Nouvelle room créée');
    }

    const room = rooms.get(roomId);

    // On autorise de rejoindre une room en cours (l'invité rejoint le canal
    // socket.io APRÈS que l'hôte ait lancé la manche ; le catch-up resynchronise).
    // On ne bloque que les parties terminées.
    if (room.status === ROOM_STATUS.FINISHED && !room.players.has(playerId)) {
      socket.emit('join-error', {
        message: 'La partie est terminée',
        code: 'GAME_FINISHED'
      });
      return;
    }

    // Vérifier le nombre max de joueurs
    if (room.players.size >= 4 && !room.players.has(playerId)) {
      socket.emit('join-error', { 
        message: 'La salle est pleine',
        code: 'ROOM_FULL'
      });
      return;
    }

    // Joindre la room socket.io
    socket.join(roomId);

    // Enregistrer les mappings
    playerSockets.set(playerId, socket.id);
    socketPlayers.set(socket.id, playerId);
    socketRooms.set(socket.id, roomId);

    // Reconnexion : préserver score, statut hôte et état de la manche.
    // (Avant, une reconnexion écrasait tout → l'hôte perdait son statut
    // et son score total repartait à zéro.)
    const existing = room.players.get(playerId);
    const isHost = existing ? existing.isHost : room.players.size === 0;

    if (existing) {
      existing.socketId = socket.id;
      existing.playerName = playerName;
      delete existing.disconnectedAt;
      log(roomId, `🔁 Reconnexion de ${playerName} (score conservé: ${existing.score})`);
    } else {
      room.players.set(playerId, {
        socketId: socket.id,
        playerName,
        isHost,
        score: 0,
        ready: false,
        finishedAt: null,
        joinedAt: Date.now()
      });
    }

    room.lastActivity = Date.now();

    // Confirmer au joueur
    socket.emit('room-joined', {
      roomId,
      playerId,
      isHost,
      playerCount: room.players.size,
      status: room.status,
      currentRound: room.currentRound.number
    });

    // Notifier les autres joueurs
    socket.to(roomId).emit('player-joined', {
      playerId,
      playerName,
      isHost,
      totalPlayers: room.players.size
    });

    // Envoyer la liste actuelle des joueurs au nouveau
    const playersList = Array.from(room.players.entries()).map(([id, data]) => ({
      playerId: id,
      playerName: data.playerName,
      isHost: data.isHost,
      ready: data.ready,
      score: data.score
    }));
    
    socket.emit('players-list', { players: playersList });

    // Démarrage différé : l'hôte a émis start-game avant que tout le monde
    // soit connecté au canal temps réel → on lance maintenant que le 2e
    // joueur est là (évite une manche finalisée à un seul joueur).
    if (room.pendingStart && room.players.size >= 2) {
      const pending = room.pendingStart;
      log(roomId, '▶️ Démarrage différé déclenché (tous les joueurs connectés)');
      startRound(roomId, {
        letter: pending.letter,
        roundDuration: pending.roundDuration,
        roundNumber: room.currentRound.number,
      });
    }
    // Catch-up : si la manche est déjà en cours, on (re)synchronise ce joueur
    // immédiatement pour éviter toute race entre join et start-game.
    else if (room.status === ROOM_STATUS.PLAYING && room.currentRound.active && room.currentRound.letter) {
      socket.emit(room.currentRound.number === 1 ? 'game-started' : 'new-round', {
        letter: room.currentRound.letter,
        roundNumber: room.currentRound.number,
        roundId: room.currentRound.id,
        roundDuration: room.gameConfig.roundDuration,
        startedAt: room.currentRound.startedAt,
        timestamp: Date.now(),
      });
      log(roomId, `⏩ Catch-up envoyé à ${playerName}`);
    }

    log(roomId, `✅ ${playerName} a rejoint. Total: ${room.players.size} joueurs`);
  });

  // ----- DÉFINIR PRÊT -----
  socket.on('set-ready', ({ roomId, playerId, ready }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.get(playerId);
    if (player) {
      player.ready = ready;
      room.lastActivity = Date.now();

      emitToRoom(roomId, 'player-ready', {
        playerId,
        ready,
        allReady: Array.from(room.players.values()).every(p => p.ready)
      });

      log(roomId, `🎯 ${player.playerName} est ${ready ? 'prêt' : 'pas prêt'}`);
    }
  });

  // ----- DÉMARRER LA PARTIE -----
  socket.on('start-game', ({ roomId, letter, roundDuration }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // Le matchmaking est géré en amont (lobby) : n'importe quel joueur de la
    // room peut déclencher le démarrage. L'app cliente s'assure que seul l'hôte
    // l'appelle. Idempotent : si la manche est déjà active, on ne relance pas.
    if (room.status === ROOM_STATUS.PLAYING && room.currentRound.active) {
      log(roomId, '↩️ start-game ignoré (manche déjà active)');
      return;
    }

    // L'adversaire n'a pas encore rejoint le canal temps réel : on diffère
    // le démarrage (join-room le déclenchera). Sinon un STOP précoce
    // finaliserait la manche avec un seul joueur.
    if (room.players.size < 2) {
      room.pendingStart = { letter, roundDuration };
      room.lastActivity = Date.now();
      log(roomId, '⏸️ start-game mis en attente (adversaire pas encore connecté)');
      return;
    }

    startRound(roomId, { letter, roundDuration, roundNumber: room.currentRound.number });
  });

  // ----- JOUEUR A TERMINÉ / A CRIÉ "STOP !" -----
  socket.on('player-finished', ({ roomId, playerId, reason }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.get(playerId);
    if (!player) return;

    const cr = room.currentRound;

    // Marquer le joueur comme terminé
    player.finishedAt = Date.now();
    cr.finishedPlayers.add(playerId);
    room.lastActivity = Date.now();

    log(roomId, `🏁 ${player.playerName} a terminé (raison: ${reason || 'manual'})`);

    // Notifier (compat) que ce joueur a fini
    emitToRoom(roomId, 'opponent-finished', {
      playerId,
      playerName: player.playerName,
      timestamp: Date.now()
    });

    // *** STOP SIMULTANÉ ***
    // Le PREMIER joueur qui termine fige la manche pour TOUT LE MONDE,
    // instantanément. Les autres reçoivent l'ordre d'arrêt et soumettent
    // leurs réponses dans l'état actuel.
    stopRound(roomId, playerId, reason || 'manual');
  });

  // ----- SOUMETTRE SCORE -----
  socket.on('submit-score', ({ roomId, playerId, score, validWordsCount, stoppedEarly, results }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.get(playerId);
    if (!player) return;

    const cr = room.currentRound;

    // Manche déjà clôturée (timeout) : on ignore les scores tardifs
    if (cr.finalized) {
      log(roomId, `↩️ Score tardif de ${player.playerName} ignoré (manche finalisée)`);
      return;
    }

    // Un seul score par joueur et par manche (anti double-soumission)
    if (cr.scores.has(playerId)) {
      log(roomId, `↩️ Score déjà reçu pour ${player.playerName}, ignoré`);
      return;
    }

    // Stocker le score + les réponses détaillées de la manche
    cr.scores.set(playerId, {
      score,
      validWordsCount,
      stoppedEarly: !!stoppedEarly,
      results: Array.isArray(results) ? results : [],
      submittedAt: Date.now()
    });

    // Mettre à jour le score total cumulé
    player.score = (player.score || 0) + score;

    room.lastActivity = Date.now();

    log(roomId, `💯 Score soumis par ${player.playerName}: ${score} pts (total ${player.score})`);

    // Notifier les autres en direct
    emitToRoom(roomId, 'score-submitted', {
      playerId,
      playerName: player.playerName,
      totalScore: player.score,
      roundScore: score,
      timestamp: Date.now()
    });

    // Dès que tous les joueurs (encore connectés) ont soumis → résultats immédiats
    maybeFinalizeRound(roomId);
  });

  // ----- DEMANDER FIN DE PARTIE -----
  socket.on('request-end-game', ({ roomId, playerId, roundId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const requester = room.players.get(playerId);
    if (!requester) return;

    log(roomId, `🚩 ${requester.playerName} demande la fin de partie`);

    // Notifier les autres joueurs
    socket.to(roomId).emit('end-game-requested', {
      playerId,
      playerName: requester.playerName,
      roundId,
      timestamp: Date.now()
    });
  });

  // ----- RÉPONDRE À LA DEMANDE DE FIN -----
  socket.on('respond-end-game', ({ roomId, playerId, requesterId, accepted }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    log(roomId, `📬 Réponse fin de partie: ${accepted ? 'Accepté' : 'Refusé'}`);

    // Notifier le demandeur
    emitToPlayer(requesterId, 'end-game-response', {
      accepted,
      responderId: playerId,
      timestamp: Date.now()
    });

    if (accepted) {
      // Terminer la manche pour tous
      room.currentRound.finishedPlayers = new Set(room.players.keys());
      emitToRoom(roomId, 'round-complete', {
        roundNumber: room.currentRound.number,
        reason: 'accepted',
        timestamp: Date.now()
      });
    }
  });

  // ----- NOUVELLE MANCHE -----
  socket.on('next-round', ({ roomId, letter }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // N'importe quel joueur peut déclencher (l'app n'autorise que l'hôte).
    // Idempotent : si une manche est déjà active, on ignore.
    if (room.currentRound.active) {
      log(roomId, '↩️ next-round ignoré (manche déjà active)');
      return;
    }

    startRound(roomId, {
      letter,
      roundDuration: room.gameConfig.roundDuration,
      roundNumber: room.currentRound.number + 1,
    });
  });

  // ----- TERMINER LA PARTIE -----
  socket.on('end-game', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // Idempotent : si les deux joueurs cliquent "Arrêter", un seul game-ended
    if (room.status === ROOM_STATUS.FINISHED) {
      log(roomId, '↩️ end-game ignoré (partie déjà terminée)');
      return;
    }

    room.status = ROOM_STATUS.FINISHED;
    clearRoundTimers(room);

    const results = Array.from(room.players.entries()).map(([id, data]) => ({
      playerId: id,
      playerName: data.playerName,
      totalScore: data.score
    }));

    results.sort((a, b) => b.totalScore - a.totalScore);

    emitToRoom(roomId, 'game-ended', {
      results,
      timestamp: Date.now()
    });

    log(roomId, '🏆 Partie terminée');
  });

  // ----- PING / KEEP-ALIVE -----
  socket.on('ping', ({ roomId, playerId }) => {
    socket.emit('pong', { 
      timestamp: Date.now(),
      roomId,
      playerId
    });
  });

  // ----- QUITTER LA ROOM -----
  socket.on('leave-room', ({ roomId, playerId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.get(playerId);
    if (!player) return;

    log(roomId, `👋 ${player.playerName} quitte la room`);

    // Notifier les autres
    socket.to(roomId).emit('player-left', {
      playerId,
      playerName: player.playerName
    });

    // Retirer le joueur
    room.players.delete(playerId);
    room.currentRound.finishedPlayers.delete(playerId);
    room.currentRound.scores.delete(playerId);

    socket.leave(roomId);
    playerSockets.delete(playerId);
    socketPlayers.delete(socket.id);
    socketRooms.delete(socket.id);

    // Si la room est vide ou si c'était l'hôte
    if (room.players.size === 0) {
      clearRoundTimers(room);
      rooms.delete(roomId);
      log(roomId, '🗑️ Room supprimée (vide)');
    } else {
      if (player.isHost) {
        // Transférer l'hôte au joueur restant le plus ancien
        const newHost = Array.from(room.players.entries())
          .sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0];

        if (newHost) {
          newHost[1].isHost = true;
          emitToRoom(roomId, 'host-changed', {
            newHostId: newHost[0],
            newHostName: newHost[1].playerName
          });
        }
      }

      // Si le partant était le seul score manquant, débloquer les autres
      maybeFinalizeRound(roomId);
    }
  });

  // ----- SYNCHRONISATION TEMPS -----
  socket.on('sync-time', ({ roomId }) => {
    socket.emit('time-sync', {
      serverTime: Date.now()
    });
  });

  // ----- DÉCONNEXION -----
  socket.on('disconnect', (reason) => {
    console.log(`🔌 Client déconnecté: ${socket.id}, raison: ${reason}`);

    const playerId = socketPlayers.get(socket.id);
    const roomId = socketRooms.get(socket.id);

    if (playerId && roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const player = room.players.get(playerId);
        
        // Notifier les autres
        socket.to(roomId).emit('player-disconnected', {
          playerId,
          playerName: player?.playerName || 'Unknown',
          reason
        });

        log(roomId, `⚠️ ${player?.playerName || playerId} déconnecté (${reason})`);

        // Si en cours de jeu, on garde le joueur mais on signale la déconnexion
        if (room.status === ROOM_STATUS.PLAYING) {
          // Le joueur peut se reconnecter
          if (player) {
            player.disconnectedAt = Date.now();
          }

          // Nettoyer les mappings AVANT de vérifier : si tous les joueurs
          // restants ont déjà soumis, on ne les fait pas attendre 20s.
          playerSockets.delete(playerId);
          socketPlayers.delete(socket.id);
          socketRooms.delete(socket.id);
          maybeFinalizeRound(roomId);
          return;
        } else {
          // Sinon on le retire
          room.players.delete(playerId);
          room.currentRound.finishedPlayers.delete(playerId);
          room.currentRound.scores.delete(playerId);

          if (room.players.size === 0) {
            clearRoundTimers(room);
            rooms.delete(roomId);
            log(roomId, '🗑️ Room supprimée (vide après déconnexion)');
          } else if (player?.isHost) {
            // Transférer l'hôte
            const newHost = Array.from(room.players.entries())
              .sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0];
            
            if (newHost) {
              newHost[1].isHost = true;
              emitToRoom(roomId, 'host-changed', {
                newHostId: newHost[0],
                newHostName: newHost[1].playerName
              });
            }
          }
        }
      }
    }

    // Nettoyer les mappings
    playerSockets.delete(playerId);
    socketPlayers.delete(socket.id);
    socketRooms.delete(socket.id);
  });
});

// ===== NETTOYAGE PÉRIODIQUE =====

// Supprimer les rooms inactives (> 2 heures)
setInterval(() => {
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const [roomId, room] of rooms.entries()) {
    if (now - room.lastActivity > twoHours) {
      rooms.delete(roomId);
      cleaned++;
      console.log(`🧹 Room inactive supprimée: ${roomId}`);
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 Nettoyage: ${cleaned} rooms supprimées`);
  }
}, 10 * 60 * 1000); // Toutes les 10 minutes

// ===== DÉMARRAGE DU SERVEUR =====

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('🚀 Serveur WebSocket Petit Bac démarré');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log('───────────────────────────────────────────────────');
  console.log(`⏰ Démarré à: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════');
});

// ===== GESTION GRACIEUSE DE L'ARRÊT =====

process.on('SIGTERM', () => {
  console.log('');
  console.log('⚠️ SIGTERM reçu, arrêt gracieux...');
  
  // Notifier toutes les rooms
  for (const [roomId, room] of rooms.entries()) {
    emitToRoom(roomId, 'server-shutdown', {
      message: 'Le serveur redémarre. Veuillez vous reconnecter.',
      timestamp: Date.now()
    });
  }

  server.close(() => {
    console.log('✅ Serveur arrêté proprement');
    process.exit(0);
  });

  // Forcer la fermeture après 10 secondes
  setTimeout(() => {
    console.log('⚠️ Fermeture forcée');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  console.log('\n⚠️ SIGINT reçu');
  process.emit('SIGTERM');
});