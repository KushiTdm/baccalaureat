-- Migration : recalcul de score autoritaire, bonus de STOP, ajout au
-- dictionnaire piloté par l'IA. À exécuter manuellement dans l'éditeur SQL
-- Supabase, APRÈS realtime-multiplayer-migration.sql.
--
-- Voir supabase/functions/game-actions/index.ts (recomputeRoundScores,
-- runDictionaryAIGate) pour la logique qui utilise ces colonnes.

-- 1. Bonus de fin de manche (+3) pour un STOP "propre", suivi séparément du
--    score brut pour rester recalculable à l'infini sans dérive.
ALTER TABLE game_round_scores
  ADD COLUMN IF NOT EXISTS stop_bonus INTEGER NOT NULL DEFAULT 0;

-- 2. Suivi de la validation IA groupée en fin de manche pour les mots
--    acceptés par accord mutuel (word_validation_votes.vote = true) mais
--    absents du dictionnaire. NULL = pas encore soumis à l'IA (ex: aucune
--    clé Gemini disponible sur les appareils des deux joueurs).
ALTER TABLE word_validation_votes
  ADD COLUMN IF NOT EXISTS ai_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_result BOOLEAN;
