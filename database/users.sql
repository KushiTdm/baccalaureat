-- ===== TABLE DES UTILISATEURS =====
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, -- Hash bcrypt du mot de passe
  avatar_url TEXT, -- URL de la photo de profil
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,
  is_online BOOLEAN DEFAULT FALSE,
  
  -- Statistiques globales
  total_games_played INTEGER DEFAULT 0,
  total_games_won INTEGER DEFAULT 0,
  total_games_lost INTEGER DEFAULT 0,
  total_games_draw INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  total_valid_words INTEGER DEFAULT 0,
  win_rate DECIMAL(5,2) DEFAULT 0.00, -- Calculé automatiquement
  
  -- Meilleurs scores
  best_round_score INTEGER DEFAULT 0,
  best_game_score INTEGER DEFAULT 0,
  
  -- Classement
  elo_rating INTEGER DEFAULT 1000, -- Rating ELO pour le classement
  rank_position INTEGER, -- Position dans le classement
  
  CONSTRAINT username_length CHECK (char_length(username) >= 3 AND char_length(username) <= 20)
);

-- Index pour les recherches fréquentes
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_elo ON users(elo_rating DESC);
CREATE INDEX idx_users_online ON users(is_online) WHERE is_online = TRUE;

-- ===== MISE À JOUR DE game_room_players =====
-- Ajouter une référence au user_id au lieu de juste player_name
ALTER TABLE game_room_players
ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE,
ADD COLUMN ready_for_next_round BOOLEAN DEFAULT FALSE;

-- Rendre player_name nullable car on peut utiliser username du user
ALTER TABLE game_room_players
ALTER COLUMN player_name DROP NOT NULL;

-- ===== HISTORIQUE DES PARTIES =====
CREATE TABLE game_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES game_rooms(id) ON DELETE CASCADE,
  player_id UUID REFERENCES users(id) ON DELETE CASCADE,
  opponent_id UUID REFERENCES users(id) ON DELETE CASCADE,
  
  -- Résultats
  result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  my_score INTEGER NOT NULL DEFAULT 0,
  opponent_score INTEGER NOT NULL DEFAULT 0,
  rounds_played INTEGER NOT NULL DEFAULT 0,
  
  -- Stats détaillées
  total_valid_words INTEGER DEFAULT 0,
  best_round_score INTEGER DEFAULT 0,
  
  -- ELO change
  elo_before INTEGER,
  elo_after INTEGER,
  elo_change INTEGER, -- +/- points gagnés/perdus
  
  -- Metadata
  played_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  duration_seconds INTEGER, -- Durée totale de la partie
  
  CONSTRAINT valid_scores CHECK (my_score >= 0 AND opponent_score >= 0)
);

-- Index pour l'historique
CREATE INDEX idx_game_history_player ON game_history(player_id, played_at DESC);
CREATE INDEX idx_game_history_opponent ON game_history(opponent_id, played_at DESC);

-- ===== RELATIONS D'AMITIÉ (optionnel) =====
CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT no_self_friendship CHECK (user_id != friend_id),
  CONSTRAINT unique_friendship UNIQUE(user_id, friend_id)
);

-- ===== ACHIEVEMENTS (optionnel) =====
CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  requirement_type TEXT NOT NULL, -- 'games_won', 'points_scored', 'perfect_games', etc.
  requirement_value INTEGER NOT NULL
);

CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  achievement_id UUID REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_user_achievement UNIQUE(user_id, achievement_id)
);

-- ===== FONCTIONS DE CALCUL =====

-- Fonction pour mettre à jour le win_rate
CREATE OR REPLACE FUNCTION update_user_win_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.total_games_played > 0 THEN
    NEW.win_rate = (NEW.total_games_won::DECIMAL / NEW.total_games_played::DECIMAL) * 100;
  ELSE
    NEW.win_rate = 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_win_rate
BEFORE UPDATE OF total_games_won, total_games_played ON users
FOR EACH ROW
EXECUTE FUNCTION update_user_win_rate();

-- Fonction pour calculer le classement
CREATE OR REPLACE FUNCTION update_rankings()
RETURNS void AS $$
BEGIN
  WITH ranked_users AS (
    SELECT 
      id,
      ROW_NUMBER() OVER (ORDER BY elo_rating DESC, total_points DESC) as new_rank
    FROM users
    WHERE total_games_played > 0
  )
  UPDATE users u
  SET rank_position = ru.new_rank
  FROM ranked_users ru
  WHERE u.id = ru.id;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour calculer le changement ELO (système ELO simplifié)
CREATE OR REPLACE FUNCTION calculate_elo_change(
  player_elo INTEGER,
  opponent_elo INTEGER,
  result TEXT -- 'win', 'loss', 'draw'
)
RETURNS INTEGER AS $$
DECLARE
  k_factor INTEGER := 32; -- Facteur K standard
  expected_score DECIMAL;
  actual_score DECIMAL;
  elo_change INTEGER;
BEGIN
  -- Calcul du score attendu
  expected_score := 1.0 / (1.0 + POWER(10, (opponent_elo - player_elo)::DECIMAL / 400.0));
  
  -- Score réel
  actual_score := CASE result
    WHEN 'win' THEN 1.0
    WHEN 'loss' THEN 0.0
    WHEN 'draw' THEN 0.5
  END;
  
  -- Changement ELO
  elo_change := ROUND(k_factor * (actual_score - expected_score));
  
  RETURN elo_change;
END;
$$ LANGUAGE plpgsql;

-- ===== VUES UTILES =====

-- Vue pour le classement des meilleurs joueurs
CREATE OR REPLACE VIEW leaderboard AS
SELECT 
  u.id,
  u.username,
  u.avatar_url,
  u.elo_rating,
  u.rank_position,
  u.total_games_played,
  u.total_games_won,
  u.win_rate,
  u.total_points,
  u.best_game_score,
  u.is_online
FROM users u
WHERE u.total_games_played > 0
ORDER BY u.elo_rating DESC, u.total_points DESC
LIMIT 100;

-- Vue pour les stats d'un joueur
CREATE OR REPLACE VIEW player_stats AS
SELECT 
  u.id,
  u.username,
  u.avatar_url,
  u.elo_rating,
  u.rank_position,
  u.total_games_played,
  u.total_games_won,
  u.total_games_lost,
  u.total_games_draw,
  u.win_rate,
  u.total_points,
  u.total_valid_words,
  u.best_round_score,
  u.best_game_score,
  ROUND(u.total_points::DECIMAL / NULLIF(u.total_games_played, 0)::DECIMAL, 1) as avg_points_per_game,
  ROUND(u.total_valid_words::DECIMAL / NULLIF(u.total_games_played, 0)::DECIMAL, 1) as avg_words_per_game
FROM users u;

-- ===== DONNÉES D'EXEMPLE POUR ACHIEVEMENTS =====
INSERT INTO achievements (code, name, description, requirement_type, requirement_value) VALUES
  ('first_win', 'Première Victoire', 'Gagnez votre première partie', 'games_won', 1),
  ('winning_streak_5', 'En Feu !', 'Gagnez 5 parties d''affilée', 'win_streak', 5),
  ('perfect_game', 'Perfection', 'Réalisez une partie parfaite (tous les mots valides)', 'perfect_games', 1),
  ('word_master', 'Maître des Mots', 'Trouvez 100 mots valides', 'total_valid_words', 100),
  ('high_scorer', 'Grand Scoreur', 'Marquez 500 points au total', 'total_points', 500),
  ('veteran', 'Vétéran', 'Jouez 50 parties', 'total_games_played', 50),
  ('champion', 'Champion', 'Atteignez un ELO de 1500', 'elo_rating', 1500);

-- ===== RLS (Row Level Security) pour Supabase =====

-- Activer RLS sur toutes les tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

-- Policies pour users
CREATE POLICY "Users can view all profiles"
  ON users FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- Policies pour game_history
CREATE POLICY "Players can view own game history"
  ON game_history FOR SELECT
  USING (auth.uid() = player_id);

CREATE POLICY "Players can insert own game history"
  ON game_history FOR INSERT
  WITH CHECK (auth.uid() = player_id);

-- ===== TRIGGER pour mettre à jour le classement après chaque partie =====
CREATE OR REPLACE FUNCTION update_rankings_after_game()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_rankings();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rankings_after_game_insert
AFTER INSERT ON game_history
FOR EACH STATEMENT
EXECUTE FUNCTION update_rankings_after_game();