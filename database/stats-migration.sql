-- Migration stats & historique (idempotente)
-- À exécuter dans l'éditeur SQL Supabase du projet Petit Bac.
-- Prérequis : users.sql doit avoir été exécuté (tables users/game_history,
-- fonction calculate_elo_change, vues leaderboard/player_stats).

-- 1. Relier les parties solo à leur joueur
ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_parties_user ON parties(user_id, date_jeu DESC);

-- 2. Relier les joueurs de salle en ligne à leur compte (nécessaire pour
--    calculer l'ELO de l'adversaire en fin de partie)
ALTER TABLE game_room_players
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_game_room_players_user ON game_room_players(user_id);
