-- ===== NETTOYAGE COMPLET =====
DROP FUNCTION IF EXISTS create_user_with_device(TEXT, TEXT);
DROP FUNCTION IF EXISTS set_username_for_device(TEXT, TEXT);
DROP FUNCTION IF EXISTS get_user_by_device(TEXT);
DROP FUNCTION IF EXISTS link_email_to_device(UUID, TEXT, TEXT);

-- Désactiver RLS
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- ===== FONCTION : CRÉER UN UTILISATEUR AVEC DEVICE_ID =====
CREATE OR REPLACE FUNCTION create_user_with_device(
  p_device_id TEXT,
  p_username TEXT DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  username text,
  email text,
  avatar_url text,
  device_id text,
  auth_type text,
  has_set_username boolean,
  is_online boolean,
  created_at timestamp with time zone,
  total_games_played integer,
  total_games_won integer,
  total_games_lost integer,
  total_games_draw integer,
  total_points integer,
  elo_rating integer,
  rank_position integer,
  win_rate numeric
) AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Log pour debug
  RAISE NOTICE 'Création utilisateur avec device_id: %', p_device_id;
  
  -- Vérifier que le device_id n'existe pas déjà
  IF EXISTS (SELECT 1 FROM users WHERE users.device_id = p_device_id) THEN
    RAISE EXCEPTION 'Un utilisateur avec ce device_id existe déjà';
  END IF;
  
  -- Créer l'utilisateur
  INSERT INTO users (device_id, username, auth_type, has_set_username, is_online)
  VALUES (
    p_device_id,
    p_username,
    'device',
    p_username IS NOT NULL,
    true
  )
  RETURNING users.id INTO v_user_id;
  
  RAISE NOTICE 'Utilisateur créé avec ID: %', v_user_id;
  
  -- Retourner l'utilisateur complet
  RETURN QUERY
  SELECT 
    u.id,
    u.username,
    u.email,
    u.avatar_url,
    u.device_id,
    u.auth_type,
    u.has_set_username,
    u.is_online,
    u.created_at,
    u.total_games_played,
    u.total_games_won,
    u.total_games_lost,
    u.total_games_draw,
    u.total_points,
    u.elo_rating,
    u.rank_position,
    u.win_rate
  FROM users u
  WHERE u.id = v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== FONCTION : OBTENIR UN UTILISATEUR PAR DEVICE_ID =====
CREATE OR REPLACE FUNCTION get_user_by_device(p_device_id TEXT)
RETURNS TABLE (
  id uuid,
  username text,
  email text,
  avatar_url text,
  device_id text,
  auth_type text,
  has_set_username boolean,
  is_online boolean,
  created_at timestamp with time zone,
  total_games_played integer,
  total_games_won integer,
  total_games_lost integer,
  total_games_draw integer,
  total_points integer,
  elo_rating integer,
  rank_position integer,
  win_rate numeric
) AS $$
BEGIN
  RAISE NOTICE 'Recherche utilisateur avec device_id: %', p_device_id;
  
  RETURN QUERY
  SELECT 
    u.id,
    u.username,
    u.email,
    u.avatar_url,
    u.device_id,
    u.auth_type,
    u.has_set_username,
    u.is_online,
    u.created_at,
    u.total_games_played,
    u.total_games_won,
    u.total_games_lost,
    u.total_games_draw,
    u.total_points,
    u.elo_rating,
    u.rank_position,
    u.win_rate
  FROM users u
  WHERE u.device_id = p_device_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== FONCTION : DÉFINIR LE USERNAME =====
CREATE OR REPLACE FUNCTION set_username_for_device(
  p_device_id TEXT,
  p_username TEXT
)
RETURNS TABLE (
  id uuid,
  username text,
  email text,
  avatar_url text,
  device_id text,
  auth_type text,
  has_set_username boolean,
  is_online boolean,
  created_at timestamp with time zone,
  total_games_played integer,
  total_games_won integer,
  total_games_lost integer,
  total_games_draw integer,
  total_points integer,
  elo_rating integer,
  rank_position integer,
  win_rate numeric
) AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Log pour debug
  RAISE NOTICE 'Mise à jour username pour device_id: %', p_device_id;
  RAISE NOTICE 'Nouveau username: %', p_username;
  
  -- Validation
  IF p_username IS NULL OR LENGTH(TRIM(p_username)) < 3 THEN
    RAISE EXCEPTION 'Le pseudo doit contenir au moins 3 caractères';
  END IF;
  
  IF LENGTH(p_username) > 20 THEN
    RAISE EXCEPTION 'Le pseudo ne peut pas dépasser 20 caractères';
  END IF;
  
  -- Récupérer l'ID utilisateur
  SELECT u.id INTO v_user_id
  FROM users u
  WHERE u.device_id = p_device_id;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non trouvé pour ce device_id: %', p_device_id;
  END IF;
  
  RAISE NOTICE 'User ID trouvé: %', v_user_id;
  
  -- Vérifier unicité du username
  IF EXISTS (
    SELECT 1 FROM users u
    WHERE LOWER(u.username) = LOWER(TRIM(p_username)) 
    AND u.id != v_user_id
  ) THEN
    RAISE EXCEPTION 'Ce pseudo est déjà pris';
  END IF;
  
  -- Mettre à jour
  UPDATE users u
  SET 
    username = TRIM(p_username),
    has_set_username = TRUE
  WHERE u.id = v_user_id;
  
  RAISE NOTICE 'Username mis à jour avec succès';
  
  -- Retourner l'utilisateur complet
  RETURN QUERY
  SELECT 
    u.id,
    u.username,
    u.email,
    u.avatar_url,
    u.device_id,
    u.auth_type,
    u.has_set_username,
    u.is_online,
    u.created_at,
    u.total_games_played,
    u.total_games_won,
    u.total_games_lost,
    u.total_games_draw,
    u.total_points,
    u.elo_rating,
    u.rank_position,
    u.win_rate
  FROM users u
  WHERE u.id = v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== FONCTION : LIER UN EMAIL =====
CREATE OR REPLACE FUNCTION link_email_to_device(
  p_user_id UUID,
  p_email TEXT,
  p_password_hash TEXT
)
RETURNS TABLE (
  id uuid,
  username text,
  email text,
  avatar_url text,
  device_id text,
  auth_type text,
  has_set_username boolean,
  is_online boolean,
  created_at timestamp with time zone,
  total_games_played integer,
  total_games_won integer,
  total_games_lost integer,
  total_games_draw integer,
  total_points integer,
  elo_rating integer,
  rank_position integer,
  win_rate numeric
) AS $$
BEGIN
  -- Vérifier que l'email n'est pas déjà pris
  IF EXISTS (SELECT 1 FROM users u WHERE u.email = p_email AND u.id != p_user_id) THEN
    RAISE EXCEPTION 'Cet email est déjà utilisé';
  END IF;
  
  -- Lier l'email
  UPDATE users u
  SET 
    email = p_email,
    password_hash = p_password_hash,
    auth_type = 'email'
  WHERE u.id = p_user_id;
  
  RETURN QUERY
  SELECT 
    u.id,
    u.username,
    u.email,
    u.avatar_url,
    u.device_id,
    u.auth_type,
    u.has_set_username,
    u.is_online,
    u.created_at,
    u.total_games_played,
    u.total_games_won,
    u.total_games_lost,
    u.total_games_draw,
    u.total_points,
    u.elo_rating,
    u.rank_position,
    u.win_rate
  FROM users u
  WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== PERMISSIONS =====
GRANT EXECUTE ON FUNCTION create_user_with_device(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_user_by_device(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_username_for_device(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION link_email_to_device(UUID, TEXT, TEXT) TO anon, authenticated;

-- ===== INDEX POUR PERFORMANCE =====
CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));