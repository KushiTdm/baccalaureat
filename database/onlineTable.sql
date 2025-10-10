-- Tables pour le jeu en ligne

-- Table des salles de jeu en ligne
CREATE TABLE game_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL UNIQUE,
  host_player_name TEXT NOT NULL,
  letter TEXT NOT NULL CHECK (length(letter) = 1),
  status TEXT NOT NULL CHECK (status IN ('waiting', 'playing', 'finished')),
  max_players INTEGER NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- Index pour rechercher les salles disponibles
CREATE INDEX idx_game_rooms_status ON game_rooms(status);
CREATE INDEX idx_game_rooms_code ON game_rooms(room_code);

-- Table des joueurs dans une salle
CREATE TABLE game_room_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  is_host BOOLEAN NOT NULL DEFAULT FALSE,
  is_ready BOOLEAN NOT NULL DEFAULT FALSE,
  score INTEGER DEFAULT 0,
  finished_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index pour récupérer les joueurs d'une salle
CREATE INDEX idx_game_room_players_room ON game_room_players(room_id);

-- Table des réponses en temps réel pour chaque joueur
CREATE TABLE game_room_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES game_room_players(id) ON DELETE CASCADE,
  categorie_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT FALSE,
  points INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index pour récupérer les réponses d'un joueur
CREATE INDEX idx_game_room_answers_player ON game_room_answers(player_id);
CREATE INDEX idx_game_room_answers_room ON game_room_answers(room_id);

-- Activer Row Level Security (RLS)
ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_room_answers ENABLE ROW LEVEL SECURITY;

-- Politiques RLS : Tout le monde peut lire et créer
CREATE POLICY "Lecture publique des salles"
  ON game_rooms FOR SELECT
  USING (true);

CREATE POLICY "Création publique des salles"
  ON game_rooms FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Mise à jour publique des salles"
  ON game_rooms FOR UPDATE
  USING (true);

CREATE POLICY "Lecture publique des joueurs"
  ON game_room_players FOR SELECT
  USING (true);

CREATE POLICY "Création publique des joueurs"
  ON game_room_players FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Mise à jour publique des joueurs"
  ON game_room_players FOR UPDATE
  USING (true);

CREATE POLICY "Lecture publique des réponses"
  ON game_room_answers FOR SELECT
  USING (true);

CREATE POLICY "Création publique des réponses"
  ON game_room_answers FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Mise à jour publique des réponses"
  ON game_room_answers FOR UPDATE
  USING (true);

-- Fonction pour générer un code de salle unique (4 caractères alphanumériques)
CREATE OR REPLACE FUNCTION generate_room_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Sans O, 0, I, 1 pour éviter confusion
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;