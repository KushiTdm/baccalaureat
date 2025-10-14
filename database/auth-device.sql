-- ===== MODIFICATION DE LA TABLE USERS POUR AUTHENTIFICATION PAR DEVICE =====

-- Ajouter les colonnes pour l'authentification par device
ALTER TABLE users
ADD COLUMN device_id TEXT UNIQUE, -- Identifiant unique du device (MAC address hashée)
ADD COLUMN auth_type TEXT DEFAULT 'device' CHECK (auth_type IN ('device', 'email')),
ADD COLUMN has_set_username BOOLEAN DEFAULT FALSE; -- Pour savoir si l'utilisateur a déjà choisi son pseudo

-- Rendre email et password_hash optionnels (nullable)
ALTER TABLE users
ALTER COLUMN email DROP NOT NULL,
ALTER COLUMN password_hash DROP NOT NULL;

-- Rendre username nullable temporairement (sera demandé au premier lancement)
ALTER TABLE users
ALTER COLUMN username DROP NOT NULL;

-- Index pour recherche rapide par device_id
CREATE INDEX idx_users_device_id ON users(device_id);

-- ===== FONCTION POUR CRÉER UN USER AVEC DEVICE_ID =====
CREATE OR REPLACE FUNCTION create_user_with_device(
  p_device_id TEXT,
  p_username TEXT DEFAULT NULL
)
RETURNS users AS $$
DECLARE
  new_user users;
BEGIN
  -- Vérifier si le device existe déjà
  SELECT * INTO new_user FROM users WHERE device_id = p_device_id;
  
  IF new_user.id IS NOT NULL THEN
    -- Device existe déjà, retourner l'utilisateur
    RETURN new_user;
  END IF;
  
  -- Créer un nouveau user
  INSERT INTO users (
    device_id,
    auth_type,
    username,
    has_set_username,
    is_online
  ) VALUES (
    p_device_id,
    'device',
    p_username,
    p_username IS NOT NULL,
    TRUE
  )
  RETURNING * INTO new_user;
  
  RETURN new_user;
END;
$$ LANGUAGE plpgsql;

-- ===== FONCTION POUR METTRE À JOUR LE USERNAME =====
CREATE OR REPLACE FUNCTION update_username(
  p_user_id UUID,
  p_username TEXT
)
RETURNS users AS $$
DECLARE
  updated_user users;
BEGIN
  -- Vérifier que le username n'est pas déjà pris
  IF EXISTS (SELECT 1 FROM users WHERE username = p_username AND id != p_user_id) THEN
    RAISE EXCEPTION 'Ce pseudo est déjà utilisé';
  END IF;
  
  -- Mettre à jour le username
  UPDATE users
  SET 
    username = p_username,
    has_set_username = TRUE
  WHERE id = p_user_id
  RETURNING * INTO updated_user;
  
  RETURN updated_user;
END;
$$ LANGUAGE plpgsql;

-- ===== FONCTION POUR LIER UN EMAIL À UN COMPTE DEVICE =====
CREATE OR REPLACE FUNCTION link_email_to_device(
  p_user_id UUID,
  p_email TEXT,
  p_password_hash TEXT
)
RETURNS users AS $$
DECLARE
  updated_user users;
BEGIN
  -- Vérifier que l'email n'est pas déjà pris
  IF EXISTS (SELECT 1 FROM users WHERE email = p_email AND id != p_user_id) THEN
    RAISE EXCEPTION 'Cet email est déjà utilisé';
  END IF;
  
  -- Lier l'email au compte
  UPDATE users
  SET 
    email = p_email,
    password_hash = p_password_hash,
    auth_type = 'email'
  WHERE id = p_user_id
  RETURNING * INTO updated_user;
  
  RETURN updated_user;
END;
$$ LANGUAGE plpgsql;

-- ===== RLS POLICIES POUR L'AUTHENTIFICATION PAR DEVICE =====

-- Policy pour permettre l'insertion avec device_id (pas besoin d'auth)
CREATE POLICY "Allow device registration"
  ON users FOR INSERT
  WITH CHECK (device_id IS NOT NULL);

-- Policy pour permettre la lecture de son propre profil par device_id
CREATE POLICY "Users can view own profile by device"
  ON users FOR SELECT
  USING (
    device_id = current_setting('app.device_id', true)
    OR auth.uid() = id
  );

-- Policy pour permettre la mise à jour de son propre profil
CREATE POLICY "Users can update own profile by device"
  ON users FOR UPDATE
  USING (
    device_id = current_setting('app.device_id', true)
    OR auth.uid() = id
  );

-- ===== CONTRAINTES DE VALIDATION =====

-- Vérifier que soit device_id, soit email est présent
ALTER TABLE users
ADD CONSTRAINT check_auth_method CHECK (
  device_id IS NOT NULL OR email IS NOT NULL
);

-- Si auth_type = 'email', email et password_hash doivent être présents
ALTER TABLE users
ADD CONSTRAINT check_email_auth CHECK (
  auth_type != 'email' OR (email IS NOT NULL AND password_hash IS NOT NULL)
);

-- Si has_set_username = true, username doit être présent
ALTER TABLE users
ADD CONSTRAINT check_username_set CHECK (
  has_set_username = FALSE OR username IS NOT NULL
);

-- ===== DONNÉES DE TEST =====
-- Créer un utilisateur de test avec device_id
SELECT create_user_with_device(
  'test_device_12345',
  'TestPlayer'
);