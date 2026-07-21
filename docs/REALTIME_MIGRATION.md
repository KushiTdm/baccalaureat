# Jeu en ligne : migration vers Supabase uniquement

Le multijoueur en ligne ne dépend plus du serveur Node.js/socket.io externe
(`websocket-server/`). Tout passe désormais par Supabase :

- **Lecture temps réel** : les clients écoutent les changements Postgres
  (`postgres_changes`) sur `game_rounds` / `game_round_scores` /
  `game_room_players` / `game_rooms`, plus la **présence** Realtime pour
  savoir qui est connecté. C'est `services/websocket.ts` (même nom de
  fichier, même API publique — aucun écran n'a eu besoin de changer).
- **Écriture autoritaire** : une **Edge Function Supabase**
  (`supabase/functions/game-actions`) exécute la logique qui doit rester
  arbitrée côté serveur — qui a crié STOP en premier, calcul des scores, règle
  « mots identiques = points partagés ». Elle utilise la clé `service_role`
  et ne peut donc pas être contournée par un client.

Le dossier `websocket-server/` peut être arrêté/supprimé une fois que le
nouveau flux est validé en jeu réel (il n'est plus référencé nulle part dans
l'app).

## ⚠️ À faire manuellement

Le connecteur Supabase MCP de cette session est rattaché à un autre projet
(« Saas-haubourdin »), pas au projet Petit Bac (`wuubarlhzvpvybxwslac`) — je
n'ai donc pas pu appliquer la migration ni déployer la fonction moi-même.
Deux étapes à faire depuis votre poste :

### 1. Migration SQL

Dans l'éditeur SQL du projet Supabase Petit Bac, exécutez le contenu de
[`database/realtime-multiplayer-migration.sql`](../database/realtime-multiplayer-migration.sql)
(après `setup-complete.sql` si ce n'est pas déjà fait). Elle ajoute :
- les colonnes de manche manquantes (`round_duration_sec`, `stopped_at`,
  `stopped_by`, `stopped_by_name`, `stopped_reason`) sur `game_rounds` ;
- une contrainte unique `(round_id, player_id)` sur `game_round_scores`
  (anti double-soumission) ;
- `game_round_scores` à la publication `supabase_realtime` (elle en manquait) ;
- la fonction `transfer_host(room_id, old_host_id)` (transfert d'hôte
  atomique, appelée directement en RPC par le client).

Idempotente : peut être ré-exécutée sans risque.

### 2. Déployer l'Edge Function

Avec le [CLI Supabase](https://supabase.com/docs/guides/cli) :

```bash
npx supabase login
npx supabase functions deploy game-actions --project-ref wuubarlhzvpvybxwslac
```

Aucune variable d'environnement à configurer : `SUPABASE_URL` et
`SUPABASE_SERVICE_ROLE_KEY` sont injectées automatiquement par Supabase dans
toutes les Edge Functions.

Vérifiez le déploiement :

```bash
npx supabase functions list --project-ref wuubarlhzvpvybxwslac
```

## Ce qui n'a pas changé

- Le matchmaking/lobby (`services/online.ts`, `app/online-setup.tsx`) était
  déjà 100 % Supabase (requêtes directes sur `game_rooms`/`game_room_players`) ;
  seul le GAMEPLAY (tirage de lettre, STOP, scores) dépendait du serveur externe.
- Le mode Bluetooth (`services/bluetooth.ts`) est indépendant, aucun rapport.

## Test de bout en bout

1. Exécuter les deux étapes ci-dessus.
2. Lancer une partie en ligne à 2 appareils (ou 2 sessions).
3. Vérifier : lettre synchronisée, chrono synchronisé, STOP simultané dès
   que l'un des deux termine, résultats identiques des deux côtés (y
   compris la règle des mots identiques si vous entrez le même mot), manche
   suivante, fin de partie.
4. Couper le réseau d'un des deux appareils quelques secondes en cours de
   partie : au retour, le canal doit se resynchroniser automatiquement
   (bannière « reconnexion » puis disparition).
