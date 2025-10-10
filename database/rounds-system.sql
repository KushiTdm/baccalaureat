-- Nouvelles tables pour le système de manches

-- Table pour gérer les manches d'une partie
CREATE TABLE game_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  letter TEXT NOT NULL CHECK (length(letter) = 1),
  status TEXT NOT NULL CHECK (status IN ('playing', 'finished')) DEFAULT 'playing',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_game_rounds_room ON game_rounds(room_id);

-- Table pour les scores par manche et par joueur
CREATE TABLE game_round_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES game_room_players(id) ON DELETE CASCADE,
  round_score INTEGER NOT NULL DEFAULT 0,
  valid_words_count INTEGER NOT NULL DEFAULT 0,
  stopped_early BOOLEAN NOT NULL DEFAULT FALSE, -- A arrêté avant la fin
  penalty_applied BOOLEAN NOT NULL DEFAULT FALSE, -- Pénalité de -3 appliquée
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_game_round_scores_round ON game_round_scores(round_id);
CREATE INDEX idx_game_round_scores_player ON game_round_scores(player_id);

-- Table pour les demandes de fin de partie
CREATE TABLE end_game_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  requester_player_id UUID NOT NULL REFERENCES game_room_players(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  responded_at TIMESTAMPTZ
);

CREATE INDEX idx_end_game_requests_room ON end_game_requests(room_id);
CREATE INDEX idx_end_game_requests_status ON end_game_requests(status);

-- Table pour les votes de validation manuelle de mots
CREATE TABLE word_validation_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  answer_id UUID NOT NULL REFERENCES game_room_answers(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  categorie_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES game_room_players(id) ON DELETE CASCADE,
  vote BOOLEAN, -- true = valide, false = invalide, NULL = pas encore voté
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  voted_at TIMESTAMPTZ
);

CREATE INDEX idx_word_validation_votes_round ON word_validation_votes(round_id);
CREATE INDEX idx_word_validation_votes_answer ON word_validation_votes(answer_id);

-- Modifier game_room_answers pour ajouter le round_id
ALTER TABLE game_room_answers
  ADD COLUMN round_id UUID REFERENCES game_rounds(id) ON DELETE CASCADE,
  ADD COLUMN needs_manual_validation BOOLEAN DEFAULT FALSE,
  ADD COLUMN manual_validation_result BOOLEAN; -- Résultat après vote

CREATE INDEX idx_game_room_answers_round ON game_room_answers(round_id);

-- Modifier game_rooms pour ajouter current_round
ALTER TABLE game_rooms
  ADD COLUMN current_round_number INTEGER DEFAULT 1;

-- RLS Policies pour les nouvelles tables
ALTER TABLE game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_round_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE end_game_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_validation_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lecture publique des manches"
  ON game_rounds FOR SELECT
  USING (true);

CREATE POLICY "Création publique des manches"
  ON game_rounds FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Mise à jour publique des manches"
  ON game_rounds FOR UPDATE
  USING (true);

CREATE POLICY "Lecture publique des scores de manche"
  ON game_round_scores FOR SELECT
  USING (true);

CREATE POLICY "Création publique des scores de manche"
  ON game_round_scores FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Mise à jour publique des scores de manche"
  ON game_round_scores FOR UPDATE
  USING (true);

CREATE POLICY "Lecture publique des demandes de fin"
  ON end_game_requests FOR SELECT
  USING (true);

CREATE POLICY "Création publique des demandes de fin"
  ON end_game_requests FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Mise à jour publique des demandes de fin"
  ON end_game_requests FOR UPDATE
  USING (true);

CREATE POLICY "Lecture publique des votes de validation"
  ON word_validation_votes FOR SELECT
  USING (true);

CREATE POLICY "Création publique des votes de validation"
  ON word_validation_votes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Mise à jour publique des votes de validation"
  ON word_validation_votes FOR UPDATE
  USING (true);