-- Migration : jeu en ligne 100% Supabase (fin de la dépendance au serveur
-- socket.io externe). À exécuter dans l'éditeur SQL Supabase, APRÈS
-- setup-complete.sql (nécessite game_rooms/game_room_players/game_rounds/
-- game_round_scores/game_room_answers déjà en place).
--
-- Le nouveau protocole temps réel repose sur :
--   - postgres_changes (Realtime) : les clients écoutent les INSERT/UPDATE
--     sur game_rounds/game_room_players pour détecter démarrage de manche,
--     STOP, fin de manche, changement d'hôte.
--   - une Edge Function `game-actions` (voir supabase/functions/game-actions)
--     qui exécute la logique autoritaire (premier STOP gagne, calcul des
--     scores, règle des mots identiques) avec la clé service_role.

-- 1. Colonnes de manche manquantes (durée, arrêt, qui/pourquoi)
ALTER TABLE game_rounds
  ADD COLUMN IF NOT EXISTS round_duration_sec INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stopped_by UUID REFERENCES game_room_players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stopped_by_name TEXT,
  ADD COLUMN IF NOT EXISTS stopped_reason TEXT;

-- 2. Un seul score par joueur et par manche (anti double-soumission,
--    remplace la vérification en mémoire du serveur socket.io)
DO $$
BEGIN
  ALTER TABLE game_round_scores
    ADD CONSTRAINT game_round_scores_round_player_key UNIQUE (round_id, player_id);
EXCEPTION WHEN duplicate_object THEN
  NULL; -- déjà présente
END $$;

-- 3. game_round_scores doit être diffusée en temps réel (elle ne l'était
--    pas : setup-complete.sql avait publié game_rounds/game_room_answers
--    mais pas cette table)
DO $$
BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE game_round_scores';
EXCEPTION WHEN duplicate_object THEN
  NULL; -- déjà présente
END $$;

-- 4. Transfert d'hôte atomique. Appelée directement en RPC par le client
--    (pas besoin de passer par l'Edge Function : les policies RLS de
--    game_room_players sont déjà publiques en écriture, et l'atomicité
--    vient du verrouillage de ligne Postgres, pas de la clé service_role).
--    Sûre si deux clients l'appellent en même temps : seul le premier trouve
--    encore is_host=true sur l'ancien hôte, le second devient un no-op.
CREATE OR REPLACE FUNCTION transfer_host(p_room_id UUID, p_old_host_id UUID)
RETURNS SETOF game_room_players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demoted_count INTEGER;
  new_host_id UUID;
BEGIN
  UPDATE game_room_players SET is_host = false
  WHERE id = p_old_host_id AND room_id = p_room_id AND is_host = true;
  GET DIAGNOSTICS demoted_count = ROW_COUNT;

  IF demoted_count = 0 THEN
    RETURN; -- déjà transféré par un appel concurrent
  END IF;

  SELECT id INTO new_host_id FROM game_room_players
  WHERE room_id = p_room_id AND id <> p_old_host_id
  ORDER BY joined_at ASC LIMIT 1;

  IF new_host_id IS NULL THEN
    RETURN; -- plus personne à promouvoir
  END IF;

  UPDATE game_room_players SET is_host = true WHERE id = new_host_id;

  RETURN QUERY SELECT * FROM game_room_players WHERE id = new_host_id;
END;
$$;
