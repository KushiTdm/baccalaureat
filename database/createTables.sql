-- Table des catégories
CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Table des mots
CREATE TABLE mots (
  id BIGSERIAL PRIMARY KEY,
  mot TEXT NOT NULL,
  mot_normalized TEXT NOT NULL,
  categorie_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(mot_normalized, categorie_id)
);

-- Index pour optimiser les recherches sur mot_normalized et categorie_id
CREATE INDEX idx_mots_normalized_categorie ON mots(mot_normalized, categorie_id);
CREATE INDEX idx_mots_categorie ON mots(categorie_id);

-- Table des parties
CREATE TABLE parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lettre TEXT NOT NULL CHECK (length(lettre) = 1),
  score INTEGER NOT NULL DEFAULT 0,
  date_jeu TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index pour trier les parties par date
CREATE INDEX idx_parties_date ON parties(date_jeu DESC);

-- Table des réponses
CREATE TABLE reponses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partie_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  categorie_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  mot_saisi TEXT NOT NULL,
  est_valide BOOLEAN NOT NULL DEFAULT FALSE,
  points INTEGER NOT NULL DEFAULT 0
);

-- Index pour récupérer les réponses d'une partie
CREATE INDEX idx_reponses_partie ON reponses(partie_id);

-- Activer Row Level Security (RLS)
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE mots ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE reponses ENABLE ROW LEVEL SECURITY;

-- Politiques RLS : Lecture publique uniquement pour categories et mots
CREATE POLICY "Lecture publique des catégories"
  ON categories FOR SELECT
  USING (true);

CREATE POLICY "Lecture publique des mots"
  ON mots FOR SELECT
  USING (true);

-- Politiques pour les parties : Tout le monde peut créer et lire
CREATE POLICY "Création publique des parties"
  ON parties FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Lecture publique des parties"
  ON parties FOR SELECT
  USING (true);

-- Politiques pour les réponses : Tout le monde peut créer et lire
CREATE POLICY "Création publique des réponses"
  ON reponses FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Lecture publique des réponses"
  ON reponses FOR SELECT
  USING (true);

-- Exemples de données initiales (optionnel - à adapter selon vos besoins)
INSERT INTO categories (nom) VALUES
  ('Prénom'),
  ('Pays'),
  ('Capitale'),
  ('Animal'),
  ('Métier'),
  ('Fruit ou légume'),
  ('Film'),
  ('Sport')
ON CONFLICT (nom) DO NOTHING;