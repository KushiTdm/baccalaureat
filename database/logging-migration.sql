-- Migration : journal d'erreurs applicatif + suivi léger du débit Gemini.
-- À exécuter manuellement dans l'éditeur SQL Supabase.
--
-- Sert à :
--   1. Consulter les erreurs survenues (edge functions ET app) après coup,
--      avec assez de contexte pour corriger sans dépendre des logs éphémères
--      de la fonction (cf supabase/functions/_shared/logger.ts).
--   2. Retrouver "quand a-t-on appelé Gemini pour la dernière fois avec CETTE
--      clé" via key_hash (jamais la clé en clair) pour espacer les appels et
--      éviter un rejet 429 du niveau gratuit.

CREATE TABLE IF NOT EXISTS app_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  source TEXT NOT NULL,                    -- 'game-actions' | 'dictionary-enrich' | 'app'
  level TEXT NOT NULL CHECK (level IN ('error', 'warn', 'info')),
  action TEXT,                             -- ex: 'submit-score', 'gemini-call', 'respond-word-validation'
  message TEXT NOT NULL,
  context JSONB,                           -- détails libres (roundId, letter, categorieId, httpStatus...)
  key_hash TEXT                            -- SHA-256 tronqué de la clé Gemini utilisée, jamais la clé elle-même
);

CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_source_level ON app_logs(source, level);
CREATE INDEX IF NOT EXISTS idx_app_logs_key_hash_action ON app_logs(key_hash, action, created_at DESC);

ALTER TABLE app_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture publique des logs" ON app_logs;
CREATE POLICY "Lecture publique des logs" ON app_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Création publique des logs" ON app_logs;
CREATE POLICY "Création publique des logs" ON app_logs FOR INSERT WITH CHECK (true);

-- Requête utile pour consulter les dernières erreurs :
--   SELECT created_at, source, level, action, message, context
--   FROM app_logs
--   WHERE level = 'error'
--   ORDER BY created_at DESC
--   LIMIT 50;
