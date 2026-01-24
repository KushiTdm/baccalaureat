// server.js - Serveur WebSocket pour Petit Bac
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
  transports: ['websocket', 'polling']
});

// Stockage en mémoire des rooms actives
const rooms = new Map();
const playerSockets = new Map(); // playerId -> socketId

// Route de santé
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    rooms: rooms.size,
    connections: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

// Connexion d'un client
io.on('connection', (socket) => {
  console.log('🔌 Client connecté:', socket.id);

  // Rejoindre une room
  socket.on('join-room', ({ roomId, playerId, playerName }) => {
    console.log(`👤 ${playerName} (${playerId}) rejoint la room ${roomId}`);
    console.log(`   Socket ID: ${socket.id}`);
    
    socket.join(roomId);
    playerSockets.set(playerId, socket.id);
    
    // Vérifier que le socket est bien dans la room
    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
    console.log(`   Sockets dans la room ${roomId}:`, socketsInRoom ? Array.from(socketsInRoom) : []);
    
    // Initialiser la room si elle n'existe pas
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        players: new Map(),
        finishedPlayers: new Set(),
        submittedScores: new Set()
      });
    }
    
    const room = rooms.get(roomId);
    room.players.set(playerId, { 
      socketId: socket.id, 
      playerName,
      joinedAt: Date.now()
    });
    
    // Notifier les autres joueurs
    socket.to(roomId).emit('player-joined', { 
      playerId, 
      playerName,
      totalPlayers: room.players.size
    });
    
    console.log(`✅ Room ${roomId}: ${room.players.size} joueurs`);
    console.log(`   Liste: ${Array.from(room.players.values()).map(p => p.playerName).join(', ')}`);
  });

  // Un joueur a fini de remplir ses réponses
  socket.on('player-finished', ({ roomId, playerId, playerName }) => {
    console.log(`🏁 ${playerName} (${playerId}) a terminé dans la room ${roomId}`);
    
    let room = rooms.get(roomId);
    if (!room) {
      console.warn('⚠️ Room pas encore créée, création automatique');
      room = {
        players: new Map(),
        finishedPlayers: new Set(),
        submittedScores: new Set()
      };
      rooms.set(roomId, room);
    }
    
    room.finishedPlayers.add(playerId);
    
    // Notifier TOUS les autres joueurs de la room
    socket.to(roomId).emit('opponent-finished', { 
      playerId, 
      playerName,
      timestamp: Date.now()
    });
    
    console.log(`📢 Notification "opponent-finished" envoyée à la room ${roomId}`);
    console.log(`   Joueurs dans la room: ${room.players.size}`);
  });

  // Un joueur a soumis son score
  socket.on('score-submitted', ({ roomId, playerId, playerName, score }) => {
    console.log(`💯 ${playerName} (${playerId}) a soumis son score: ${score}`);
    
    const room = rooms.get(roomId);
    if (!room) return;
    
    room.submittedScores.add(playerId);
    
    // Si tous les joueurs ont soumis, notifier
    if (room.submittedScores.size === room.players.size) {
      console.log(`✅ Tous les joueurs de ${roomId} ont soumis`);
      io.to(roomId).emit('all-scores-submitted', {
        roomId,
        timestamp: Date.now()
      });
    }
  });

  // Demande de fin de partie
  socket.on('request-end-game', ({ roomId, playerId, playerName }) => {
    console.log(`🚩 ${playerName} demande la fin de partie dans ${roomId}`);
    
    socket.to(roomId).emit('end-game-requested', { 
      playerId, 
      playerName,
      timestamp: Date.now()
    });
  });

  // Réponse à une demande de fin
  socket.on('respond-end-game', ({ roomId, requesterId, accepted }) => {
    console.log(`📬 Réponse à la demande: ${accepted ? 'Accepté' : 'Refusé'}`);
    
    const requesterSocketId = playerSockets.get(requesterId);
    if (requesterSocketId) {
      io.to(requesterSocketId).emit('end-game-response', { 
        accepted,
        timestamp: Date.now()
      });
    }
  });

  // Ping pour keep-alive
  socket.on('ping', ({ roomId, playerId }) => {
    socket.emit('pong', { 
      timestamp: Date.now(),
      roomId,
      playerId
    });
  });

  // Déconnexion
  socket.on('disconnect', () => {
    console.log('🔌 Client déconnecté:', socket.id);
    
    // Trouver le joueur et la room
    let disconnectedPlayerId = null;
    for (const [playerId, socketId] of playerSockets.entries()) {
      if (socketId === socket.id) {
        disconnectedPlayerId = playerId;
        playerSockets.delete(playerId);
        break;
      }
    }
    
    if (disconnectedPlayerId) {
      // Trouver la room et notifier
      for (const [roomId, room] of rooms.entries()) {
        if (room.players.has(disconnectedPlayerId)) {
          const playerName = room.players.get(disconnectedPlayerId).playerName;
          room.players.delete(disconnectedPlayerId);
          room.finishedPlayers.delete(disconnectedPlayerId);
          room.submittedScores.delete(disconnectedPlayerId);
          
          socket.to(roomId).emit('player-left', { 
            playerId: disconnectedPlayerId,
            playerName
          });
          
          console.log(`👋 ${playerName} a quitté la room ${roomId}`);
          
          // Supprimer la room si vide
          if (room.players.size === 0) {
            rooms.delete(roomId);
            console.log(`🗑️ Room ${roomId} supprimée (vide)`);
          }
          
          break;
        }
      }
    }
  });

  // Quitter une room manuellement
  socket.on('leave-room', ({ roomId, playerId }) => {
    console.log(`👋 ${playerId} quitte la room ${roomId}`);
    
    socket.leave(roomId);
    playerSockets.delete(playerId);
    
    const room = rooms.get(roomId);
    if (room) {
      const playerName = room.players.get(playerId)?.playerName;
      room.players.delete(playerId);
      room.finishedPlayers.delete(playerId);
      room.submittedScores.delete(playerId);
      
      socket.to(roomId).emit('player-left', { 
        playerId,
        playerName
      });
      
      // Supprimer la room si vide
      if (room.players.size === 0) {
        rooms.delete(roomId);
        console.log(`🗑️ Room ${roomId} supprimée`);
      }
    }
  });
});

// Nettoyage périodique des rooms inactives (> 1 heure)
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [roomId, room] of rooms.entries()) {
    let allInactive = true;
    for (const player of room.players.values()) {
      if (now - player.joinedAt < oneHour) {
        allInactive = false;
        break;
      }
    }
    
    if (allInactive) {
      rooms.delete(roomId);
      console.log(`🧹 Room inactive supprimée: ${roomId}`);
    }
  }
}, 10 * 60 * 1000); // Toutes les 10 minutes

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('🚀 Serveur WebSocket démarré sur le port', PORT);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
});

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM reçu, arrêt gracieux...');
  server.close(() => {
    console.log('✅ Serveur arrêté');
    process.exit(0);
  });
});