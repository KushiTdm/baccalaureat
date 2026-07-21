// supabase/functions/game-actions/index.ts
//
// Logique autoritaire du multijoueur en ligne "Petit Bac" (remplace le
// serveur socket.io externe). Utilise la clé service_role : seule cette
// fonction peut décider qui a gagné le "premier STOP", finaliser une manche
// et appliquer la règle des mots identiques. Le reste de l'app (client
// Realtime) ne fait que LIRE l'état via postgres_changes/requêtes directes,
// protégé par les policies RLS "lecture publique" déjà en place.
//
// Le score n'est JAMAIS accumulé de façon incrémentale (`score = score + X`) :
// à chaque événement qui peut le changer (fin de manche, validation
// manuelle, gate IA), `recomputeRoundScores` recalcule tout depuis les
// données sources (game_room_answers, game_rounds, word_validation_votes) et
// resynchronise `game_room_players.score`. C'est ce qui garantit que le
// score affiché correspond toujours à la réalité, même après une correction
// tardive (mot validé après coup, pénalité remboursée, bonus de STOP...).
//
// Actions (POST { action, ... }) :
//   start-round             : démarre la 1re manche d'une room
//   player-finished         : un joueur crie STOP (le premier à écrire gagne)
//   submit-score            : soumet le score + réponses détaillées d'un joueur
//   finalize-round          : force la finalisation (filet de sécurité côté client)
//   next-round              : démarre la manche suivante (lettre tirée serveur)
//   end-game                : termine la partie
//   request-word-validation : demande la validation manuelle d'un mot absent
//                             du dictionnaire (accord mutuel entre joueurs)
//   respond-word-validation : répond à une demande de validation manuelle
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkWordsBatch, isSafeCandidateWord, WordCheckResult } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Identique à utils/normalize.ts côté client (minuscules, trim, sans accents)
function normalizeWord(word: string): string {
  return String(word || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Identique à utils/letters.ts côté client (le runtime Deno ne peut pas
// importer directement les fichiers React Native).
const GAME_LETTERS = "ABCDEFGHIJLMNOPRSTUV".split("");

type RoundAnswerResult = {
  categorieId: number;
  categorieName: string;
  word: string;
  isValid: boolean;
  points: number;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "start-round":
        return json(await startRound(supabase, body));
      case "player-finished":
        return json(await playerFinished(supabase, body));
      case "submit-score":
        return json(await submitScore(supabase, body));
      case "finalize-round":
        return json(await finalizeRound(supabase, body.roundId));
      case "next-round":
        return json(await nextRound(supabase, body));
      case "end-game":
        return json(await endGame(supabase, body));
      case "request-word-validation":
        return json(await requestWordValidation(supabase, body));
      case "respond-word-validation":
        return json(await respondWordValidation(supabase, body));
      default:
        return json({ error: `Action inconnue: ${action}` }, 400);
    }
  } catch (error) {
    console.error("game-actions error:", error);
    return json({ error: (error as Error).message || "Erreur serveur" }, 500);
  }
});

// ---------- Tirage de lettre côté serveur (non-répétition garantie) ----------

/**
 * Tire une lettre en évitant celles déjà jouées dans la room (colonne
 * `game_rooms.used_letters`) ; réinitialise le pool une fois les 20 lettres
 * épuisées. Autoritaire : le client ne choisit plus jamais la lettre des
 * manches suivantes, ce qui élimine les races où une manche non encore
 * "commitée" côté client aurait pu faire ressortir la même lettre.
 */
async function pickServerLetter(supabase: SupabaseClient, roomId: string): Promise<string> {
  const { data: room } = await supabase.from("game_rooms").select("used_letters").eq("id", roomId).single();
  let used: string[] = room?.used_letters || [];
  let pool = GAME_LETTERS.filter((l) => !used.includes(l));
  if (pool.length === 0) {
    used = [];
    pool = GAME_LETTERS;
  }
  const letter = pool[Math.floor(Math.random() * pool.length)];
  await supabase.from("game_rooms").update({ used_letters: [...used, letter] }).eq("id", roomId);
  return letter;
}

// ---------- start-round / next-round ----------

async function startRound(
  supabase: SupabaseClient,
  { roomId, letter, roundDurationSec, roundNumber }:
    { roomId: string; letter: string; roundDurationSec: number; roundNumber: number }
) {
  // Idempotent : une manche avec ce numéro existe-t-elle déjà pour cette room ?
  const { data: existing } = await supabase
    .from("game_rounds")
    .select("*")
    .eq("room_id", roomId)
    .eq("round_number", roundNumber)
    .maybeSingle();

  if (existing) {
    return { round: existing, created: false };
  }

  // Filet de sécurité : la 1ère manche est tirée côté client (rien à
  // exclure) et amorce normalement `used_letters` à la création de la room
  // (app/online-setup.tsx) — on s'assure ici qu'elle y figure bien, même si
  // ce n'est pas le cas (ancienne version de l'app, room créée autrement).
  if (roundNumber === 1 && letter) {
    const { data: room } = await supabase.from("game_rooms").select("used_letters").eq("id", roomId).single();
    const used: string[] = room?.used_letters || [];
    if (!used.includes(letter)) {
      await supabase.from("game_rooms").update({ used_letters: [...used, letter] }).eq("id", roomId);
    }
  }

  const { data: round, error } = await supabase
    .from("game_rounds")
    .insert({
      room_id: roomId,
      round_number: roundNumber,
      letter,
      round_duration_sec: roundDurationSec || 120,
      status: "playing",
    })
    .select()
    .single();

  if (error) throw error;

  await supabase
    .from("game_rooms")
    .update({ status: "playing", current_round_number: roundNumber })
    .eq("id", roomId);

  return { round, created: true };
}

async function nextRound(
  supabase: SupabaseClient,
  { roomId, roundDurationSec }: { roomId: string; roundDurationSec?: number }
) {
  // Manche déjà active pour cette room ? (idempotent)
  const { data: active } = await supabase
    .from("game_rounds")
    .select("*")
    .eq("room_id", roomId)
    .eq("status", "playing")
    .maybeSingle();

  if (active) {
    return { round: active, created: false };
  }

  const { data: room, error: roomError } = await supabase
    .from("game_rooms")
    .select("current_round_number")
    .eq("id", roomId)
    .single();
  if (roomError) throw roomError;

  const roundNumber = (room.current_round_number || 1) + 1;
  // La lettre n'est plus jamais fournie par le client à partir d'ici : le
  // serveur est seul autoritaire, via `game_rooms.used_letters`.
  const letter = await pickServerLetter(supabase, roomId);

  return startRound(supabase, {
    roomId,
    letter,
    roundDurationSec: roundDurationSec || 120,
    roundNumber,
  });
}

// ---------- player-finished (STOP simultané) ----------

async function playerFinished(
  supabase: SupabaseClient,
  { roundId, playerId, reason }: { roundId: string; playerId: string; reason: string }
) {
  const { data: player } = await supabase
    .from("game_room_players")
    .select("player_name")
    .eq("id", playerId)
    .maybeSingle();

  // "WHERE stopped_at IS NULL" = seul le premier appel à atteindre la base
  // gagne, quel que soit le nombre d'instances de la fonction en parallèle.
  const { data: updated } = await supabase
    .from("game_rounds")
    .update({
      stopped_at: new Date().toISOString(),
      stopped_by: playerId,
      stopped_by_name: player?.player_name || null,
      stopped_reason: reason || "manual",
    })
    .eq("id", roundId)
    .is("stopped_at", null)
    .select()
    .maybeSingle();

  if (updated) return { round: updated };

  // Déjà stoppée par quelqu'un d'autre : renvoyer l'état existant (idempotent)
  const { data: current, error } = await supabase
    .from("game_rounds")
    .select("*")
    .eq("id", roundId)
    .single();
  if (error) throw error;
  return { round: current };
}

// ---------- submit-score ----------

async function submitScore(
  supabase: SupabaseClient,
  { roomId, roundId, playerId, score, validWordsCount, stoppedEarly, results }: {
    roomId: string; roundId: string; playerId: string; score: number;
    validWordsCount: number; stoppedEarly: boolean; results: RoundAnswerResult[];
  }
) {
  // Contrainte unique (round_id, player_id) = anti double-soumission.
  // `round_score` est provisoire ici (valeur envoyée par le client, pour un
  // affichage immédiat) : `recomputeRoundScores` l'écrasera avec la valeur
  // définitive dès que la manche sera finalisée.
  const { error: insertError } = await supabase
    .from("game_round_scores")
    .insert({
      round_id: roundId,
      player_id: playerId,
      round_score: score,
      valid_words_count: validWordsCount,
      stopped_early: !!stoppedEarly,
      finished_at: new Date().toISOString(),
    });

  if (insertError) {
    if (insertError.code === "23505") {
      // Déjà soumis : on ignore silencieusement (comportement idempotent)
      return { submitted: false, alreadySubmitted: true };
    }
    throw insertError;
  }

  if (Array.isArray(results) && results.length > 0) {
    const rows = results
      .filter((r) => r && r.word && r.word.trim() !== "")
      .map((r) => ({
        room_id: roomId,
        player_id: playerId,
        round_id: roundId,
        categorie_id: r.categorieId,
        word: r.word,
        is_valid: !!r.isValid,
        points: r.points || 0,
      }));
    if (rows.length > 0) {
      const { error: answersError } = await supabase.from("game_room_answers").insert(rows);
      if (answersError) throw answersError;
    }
  }

  // Finalisation dès que tous les joueurs de la room ont soumis un score
  const { count: playerCount } = await supabase
    .from("game_room_players")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId);

  const { count: scoreCount } = await supabase
    .from("game_round_scores")
    .select("id", { count: "exact", head: true })
    .eq("round_id", roundId);

  if ((scoreCount || 0) >= (playerCount || 0) && (playerCount || 0) > 0) {
    const finalized = await finalizeRound(supabase, roundId);
    return { submitted: true, finalized: true, results: finalized.results };
  }

  return { submitted: true, finalized: false };
}

// ---------- finalize-round (recalcul de score + gate IA dictionnaire) ----------

async function finalizeRound(supabase: SupabaseClient, roundId: string) {
  const { data: round, error: roundFetchError } = await supabase
    .from("game_rounds")
    .select("*")
    .eq("id", roundId)
    .single();
  if (roundFetchError) throw roundFetchError;

  if (round.status === "finished") {
    return { results: await buildResults(supabase, round) };
  }

  const { data: updated } = await supabase
    .from("game_rounds")
    .update({ status: "finished", finished_at: new Date().toISOString() })
    .eq("id", roundId)
    .eq("status", "playing")
    .select()
    .maybeSingle();

  if (!updated) {
    // Un appel concurrent vient de finaliser en premier (idempotent)
    const { data: current } = await supabase.from("game_rounds").select("*").eq("id", roundId).single();
    return { results: await buildResults(supabase, current) };
  }

  await recomputeRoundScores(supabase, roundId);
  // Le gate IA dictionnaire (voir runDictionaryAIGate) n'a rien à traiter
  // ICI : aucune validation manuelle n'a encore pu avoir lieu à ce stade
  // (elle nécessite les résultats déjà affichés, donc la manche déjà
  // finalisée). Il est déclenché par respondWordValidation.

  return { results: await buildResults(supabase, updated) };
}

// ---------- recomputeRoundScores : recalcul autoritaire unique ----------
//
// Recalcule TOUT depuis les données sources plutôt que d'accumuler des
// deltas (+2, -3...). Appelé à la fin de `finalizeRound` et de
// `respondWordValidation` (approbation ou refus) : idempotent, peut être
// rejoué autant de fois que nécessaire sans jamais diverger.
//
// Règles appliquées (Petit Bac) :
//   - mot valide trouvé par plusieurs joueurs dans la même catégorie → 1pt
//     chacun au lieu de 2 (règle des mots dupliqués) ;
//   - pénalité de -3 si le joueur a crié STOP avec grille pleine et au moins
//     un mot invalide restant (remboursée automatiquement si une validation
//     manuelle ultérieure corrige ce dernier mot) ;
//   - bonus de +3 pour le joueur qui a crié STOP (raison "manual") si sa
//     grille était pleine et 100% valide, qu'aucune validation n'est en
//     attente, ET que l'adversaire avait lui aussi une grille pleine à ce
//     moment.
async function recomputeRoundScores(supabase: SupabaseClient, roundId: string) {
  const { data: round, error: roundError } = await supabase
    .from("game_rounds")
    .select("id, room_id, stopped_by, stopped_reason")
    .eq("id", roundId)
    .single();
  if (roundError) throw roundError;

  const [{ data: answers, error: answersError }, { count: categoryCount }, { data: players, error: playersError }] =
    await Promise.all([
      supabase
        .from("game_room_answers")
        .select("id, player_id, categorie_id, word, is_valid, points")
        .eq("round_id", roundId),
      supabase.from("categories").select("id", { count: "exact", head: true }),
      supabase.from("game_room_players").select("id").eq("room_id", round.room_id),
    ]);
  if (answersError) throw answersError;
  if (playersError) throw playersError;

  const catCount = categoryCount || 0;
  const allAnswers = answers || [];

  // 1. Règle des mots dupliqués : recalcule les points de chaque réponse.
  const byCategory = new Map<number, Map<string, typeof allAnswers>>();
  for (const a of allAnswers) {
    if (!a.is_valid || !a.word) continue;
    if (!byCategory.has(a.categorie_id)) byCategory.set(a.categorie_id, new Map());
    const words = byCategory.get(a.categorie_id)!;
    const key = normalizeWord(a.word);
    if (!words.has(key)) words.set(key, []);
    words.get(key)!.push(a);
  }

  const newPointsByAnswerId = new Map<string, number>();
  const pointUpdates: Promise<any>[] = [];
  for (const a of allAnswers) {
    let newPoints = 0;
    if (a.is_valid) {
      const holders = byCategory.get(a.categorie_id)?.get(normalizeWord(a.word)) || [];
      newPoints = holders.length > 1 ? 1 : 2;
    }
    newPointsByAnswerId.set(a.id, newPoints);
    if (newPoints !== a.points) {
      pointUpdates.push(supabase.from("game_room_answers").update({ points: newPoints }).eq("id", a.id));
    }
  }
  if (pointUpdates.length) await Promise.all(pointUpdates);

  // 2. Validations en attente par joueur (bloque le bonus tant qu'un mot
  //    n'a pas encore été tranché par l'adversaire).
  const { data: pendingVotes } = await supabase
    .from("word_validation_votes")
    .select("player_id")
    .eq("round_id", roundId)
    .is("vote", null);
  const pendingByPlayer = new Set((pendingVotes || []).map((v) => v.player_id));

  // 3. Statistiques par joueur pour cette manche.
  const answersByPlayer = new Map<string, typeof allAnswers>();
  for (const a of allAnswers) {
    if (!answersByPlayer.has(a.player_id)) answersByPlayer.set(a.player_id, []);
    answersByPlayer.get(a.player_id)!.push(a);
  }

  const { data: scoreRows } = await supabase
    .from("game_round_scores")
    .select("id, player_id, stopped_early")
    .eq("round_id", roundId);

  const playerIds = (players || []).map((p) => p.id);
  const roundUpdates: Promise<any>[] = [];

  for (const playerId of playerIds) {
    const scoreRow = (scoreRows || []).find((s) => s.player_id === playerId);
    if (!scoreRow) continue; // ce joueur n'a pas encore soumis

    const myAnswers = answersByPlayer.get(playerId) || [];
    const roundPoints = myAnswers.reduce((sum, a) => sum + (newPointsByAnswerId.get(a.id) || 0), 0);
    const filledCount = myAnswers.length; // seuls les mots non-vides ont une ligne
    const hasInvalidWord = myAnswers.some((a) => !a.is_valid);
    const allFieldsFilled = catCount > 0 && filledCount === catCount;
    const noPendingValidation = !pendingByPlayer.has(playerId);

    const penalty = scoreRow.stopped_early && allFieldsFilled && hasInvalidWord ? 3 : 0;

    let bonus = 0;
    const isStopper = round.stopped_reason === "manual" && round.stopped_by === playerId;
    if (isStopper && allFieldsFilled && !hasInvalidWord && noPendingValidation) {
      const opponentIds = playerIds.filter((id) => id !== playerId);
      const opponentAllFilled =
        opponentIds.length > 0 &&
        opponentIds.every((oid) => (answersByPlayer.get(oid) || []).length === catCount);
      if (opponentAllFilled) bonus = 3;
    }

    const round_score = Math.max(0, roundPoints - penalty + bonus);
    roundUpdates.push(
      supabase
        .from("game_round_scores")
        .update({
          round_score,
          valid_words_count: myAnswers.filter((a) => a.is_valid).length,
          penalty_applied: penalty > 0,
          stop_bonus: bonus,
        })
        .eq("id", scoreRow.id)
    );
  }
  if (roundUpdates.length) await Promise.all(roundUpdates);

  await resyncPlayerTotals(supabase, round.room_id);
}

/** Resynchronise le score cumulé de chaque joueur = somme de TOUS ses
 * round_score dans la room (jamais un `+=` incrémental). */
async function resyncPlayerTotals(supabase: SupabaseClient, roomId: string) {
  const [{ data: rounds }, { data: players }] = await Promise.all([
    supabase.from("game_rounds").select("id").eq("room_id", roomId),
    supabase.from("game_room_players").select("id").eq("room_id", roomId),
  ]);
  const roundIds = (rounds || []).map((r) => r.id);
  if (roundIds.length === 0 || !players || players.length === 0) return;

  const { data: allScores } = await supabase
    .from("game_round_scores")
    .select("player_id, round_score")
    .in("round_id", roundIds);

  const totals = new Map<string, number>();
  for (const s of allScores || []) {
    totals.set(s.player_id, (totals.get(s.player_id) || 0) + (s.round_score || 0));
  }

  await Promise.all(
    players.map((p) => supabase.from("game_room_players").update({ score: totals.get(p.id) || 0 }).eq("id", p.id))
  );
}

// ---------- Gate IA de fin de manche (ajout permanent au dictionnaire) ----------
//
// Les mots validés par accord mutuel entre joueurs (word_validation_votes,
// vote = true) comptent IMMÉDIATEMENT pour le score de la manche (voir
// respondWordValidation), mais ne sont plus jamais insérés directement dans
// `mots`. L'ajout permanent au dictionnaire partagé passe systématiquement
// par ce gate IA groupé, une seule fois en fin de manche.
async function runDictionaryAIGate(supabase: SupabaseClient, roundId: string, geminiApiKey?: string) {
  const { data: pendingVotes } = await supabase
    .from("word_validation_votes")
    .select("id, word, categorie_id, categories(nom)")
    .eq("round_id", roundId)
    .eq("vote", true)
    .is("ai_checked_at", null);

  if (!pendingVotes || pendingVotes.length === 0) return;

  const { data: round } = await supabase.from("game_rounds").select("letter").eq("id", roundId).single();
  const letter = round?.letter || "";

  // Mots déjà présents dans le dictionnaire (ajoutés entre-temps par une
  // autre partie) : pas besoin de solliciter l'IA.
  const stillNeedsCheck: typeof pendingVotes = [];
  for (const v of pendingVotes) {
    const norm = normalizeWord(v.word);
    const { data: existingWord } = await supabase
      .from("mots")
      .select("id")
      .eq("mot_normalized", norm)
      .eq("categorie_id", v.categorie_id)
      .maybeSingle();
    if (existingWord) {
      await supabase
        .from("word_validation_votes")
        .update({ ai_checked_at: new Date().toISOString(), ai_result: true })
        .eq("id", v.id);
    } else {
      stillNeedsCheck.push(v);
    }
  }

  if (stillNeedsCheck.length === 0) return;

  // Aucune clé Gemini disponible pour cette manche : les mots restent en
  // attente (ai_checked_at NULL) — l'app le signale à l'utilisateur plutôt
  // que d'échouer silencieusement.
  if (!geminiApiKey) return;

  let verdicts: WordCheckResult[] = [];
  try {
    verdicts = await checkWordsBatch(
      geminiApiKey,
      stillNeedsCheck.map((v) => ({
        word: v.word,
        categorieId: v.categorie_id,
        categorieName: (v as any).categories?.nom || "",
        letter,
      }))
    );
  } catch (e) {
    console.error("runDictionaryAIGate: appel Gemini échoué (non bloquant):", e);
    return; // les mots restent en attente, retentés à la prochaine manche finalisée avec une clé
  }

  const verdictByKey = new Map(verdicts.map((r) => [`${r.categorieId}:${normalizeWord(r.word)}`, r.valid]));

  for (const v of stillNeedsCheck) {
    const key = `${v.categorie_id}:${normalizeWord(v.word)}`;
    const geminiSaysValid = verdictByKey.get(key) === true;
    const safe = geminiSaysValid && isSafeCandidateWord(v.word, letter);

    if (safe) {
      try {
        await supabase.from("mots").upsert(
          { mot: v.word, mot_normalized: normalizeWord(v.word), categorie_id: v.categorie_id },
          { onConflict: "mot_normalized,categorie_id", ignoreDuplicates: true }
        );
      } catch (e) {
        console.error("runDictionaryAIGate: insertion dictionnaire échouée (non bloquant):", e);
      }
    }

    await supabase
      .from("word_validation_votes")
      .update({ ai_checked_at: new Date().toISOString(), ai_result: !!safe })
      .eq("id", v.id);
  }
}

async function buildResults(supabase: SupabaseClient, round: { id: string; room_id: string }) {
  const { data: players, error: playersError } = await supabase
    .from("game_room_players")
    .select("id, player_name, score")
    .eq("room_id", round.room_id);
  if (playersError) throw playersError;

  const { data: scores } = await supabase
    .from("game_round_scores")
    .select("player_id, round_score, valid_words_count, stopped_early")
    .eq("round_id", round.id);

  const { data: answers } = await supabase
    .from("game_room_answers")
    .select("player_id, categorie_id, word, is_valid, points, categories(nom)")
    .eq("round_id", round.id);

  const scoreByPlayer = new Map((scores || []).map((s) => [s.player_id, s]));
  const answersByPlayer = new Map<string, RoundAnswerResult[]>();
  for (const a of answers || []) {
    if (!answersByPlayer.has(a.player_id)) answersByPlayer.set(a.player_id, []);
    answersByPlayer.get(a.player_id)!.push({
      categorieId: a.categorie_id,
      categorieName: (a as any).categories?.nom || "",
      word: a.word,
      isValid: a.is_valid,
      points: a.points,
    });
  }

  const results = (players || []).map((p) => {
    const s = scoreByPlayer.get(p.id);
    return {
      playerId: p.id,
      playerName: p.player_name,
      totalScore: p.score || 0,
      roundScore: s?.round_score || 0,
      validWordsCount: s?.valid_words_count || 0,
      stoppedEarly: s?.stopped_early || false,
      results: answersByPlayer.get(p.id) || [],
    };
  });

  results.sort((a, b) => b.totalScore - a.totalScore);
  return results;
}

// ---------- end-game ----------

async function endGame(supabase: SupabaseClient, { roomId }: { roomId: string }) {
  const { data: updated } = await supabase
    .from("game_rooms")
    .update({ status: "finished", finished_at: new Date().toISOString() })
    .eq("id", roomId)
    .neq("status", "finished")
    .select()
    .maybeSingle();

  // Scores finaux réels (source de vérité pour l'écran de résultats final,
  // au lieu d'une reconstruction côté client à partir de l'historique local).
  const { data: players } = await supabase
    .from("game_room_players")
    .select("id, player_name, score")
    .eq("room_id", roomId);

  return { room: updated, players: players || [] };
}

// ---------- request-word-validation / respond-word-validation ----------
//
// Validation manuelle par ACCORD MUTUEL d'un mot absent du dictionnaire :
// `player_id` sur word_validation_votes désigne toujours le joueur
// PROPRIÉTAIRE du mot à valider (celui qui l'a proposé), jamais le votant —
// avec 2 joueurs, le votant est forcément l'autre joueur de la room.
//
// L'accord mutuel ne fait foi que pour le SCORE de la manche en cours ;
// l'ajout permanent au dictionnaire partagé passe toujours par le gate IA
// de fin de manche (voir runDictionaryAIGate).

async function requestWordValidation(
  supabase: SupabaseClient,
  { roomId, roundId, playerId, categorieId, word }: {
    roomId: string; roundId: string; playerId: string; categorieId: number;
    categorieName?: string; word: string;
  }
) {
  const { data: answer, error: answerError } = await supabase
    .from("game_room_answers")
    .select("id")
    .eq("round_id", roundId)
    .eq("player_id", playerId)
    .eq("categorie_id", categorieId)
    .maybeSingle();
  if (answerError) throw answerError;
  if (!answer) throw new Error("Réponse introuvable pour cette catégorie");

  // Idempotent : une demande déjà en attente (pas encore votée) pour ce mot
  // existe-t-elle ? Évite d'inonder l'adversaire de plusieurs alertes.
  const { data: existing } = await supabase
    .from("word_validation_votes")
    .select("*")
    .eq("round_id", roundId)
    .eq("player_id", playerId)
    .eq("categorie_id", categorieId)
    .is("vote", null)
    .maybeSingle();
  if (existing) return { vote: existing, created: false };

  const { data: vote, error } = await supabase
    .from("word_validation_votes")
    .insert({
      room_id: roomId,
      round_id: roundId,
      answer_id: answer.id,
      word,
      categorie_id: categorieId,
      player_id: playerId,
      vote: null,
    })
    .select()
    .single();
  if (error) throw error;

  return { vote, created: true };
}

async function respondWordValidation(
  supabase: SupabaseClient,
  { voteId, approved, geminiApiKey }: { voteId: string; approved: boolean; geminiApiKey?: string }
) {
  // "WHERE vote IS NULL" = idempotent, ignore un second vote sur la même demande
  const { data: vote } = await supabase
    .from("word_validation_votes")
    .update({ vote: approved, voted_at: new Date().toISOString() })
    .eq("id", voteId)
    .is("vote", null)
    .select()
    .maybeSingle();

  if (!vote) {
    const { data: current, error } = await supabase
      .from("word_validation_votes")
      .select("*")
      .eq("id", voteId)
      .single();
    if (error) throw error;
    return { vote: current };
  }

  if (approved) {
    await supabase
      .from("game_room_answers")
      .update({
        is_valid: true,
        manual_validation_result: true,
        needs_manual_validation: false,
      })
      .eq("id", vote.answer_id);

    // Si l'adversaire a écrit EXACTEMENT le même mot pour la même catégorie
    // et qu'il est encore invalide, on le valide automatiquement aussi (plus
    // besoin qu'il sollicite sa propre demande) — voir Partie 2 du plan.
    await autoValidateMatchingAnswer(supabase, vote);
  } else {
    await supabase
      .from("game_room_answers")
      .update({ manual_validation_result: false, needs_manual_validation: false })
      .eq("id", vote.answer_id);
  }

  // Recalcul complet : applique le partage de points si mot dupliqué,
  // rembourse une pénalité devenue caduque, etc.
  await recomputeRoundScores(supabase, vote.round_id);

  // Le round est déjà "finished" à ce stade (toute validation manuelle a
  // lieu APRÈS finalizeRound, une fois les résultats affichés) : c'est ICI,
  // pas dans finalizeRound, que le gate IA groupé doit tourner à chaque
  // validation résolue (il ne retraite jamais un mot déjà `ai_checked_at`).
  await runDictionaryAIGate(supabase, vote.round_id, geminiApiKey);

  return { vote };
}

async function autoValidateMatchingAnswer(
  supabase: SupabaseClient,
  vote: { answer_id: string }
) {
  const { data: answer } = await supabase
    .from("game_room_answers")
    .select("id, room_id, round_id, player_id, categorie_id, word")
    .eq("id", vote.answer_id)
    .maybeSingle();
  if (!answer || !answer.word) return;

  const targetNormalized = normalizeWord(answer.word);

  const { data: candidates } = await supabase
    .from("game_room_answers")
    .select("id, player_id, word")
    .eq("round_id", answer.round_id)
    .eq("categorie_id", answer.categorie_id)
    .neq("player_id", answer.player_id)
    .eq("is_valid", false);

  const match = (candidates || []).find((c) => c.word && normalizeWord(c.word) === targetNormalized);
  if (!match) return;

  await supabase
    .from("game_room_answers")
    .update({ is_valid: true, manual_validation_result: true, needs_manual_validation: false })
    .eq("id", match.id);

  // Résout une éventuelle demande déjà en attente pour ce mot (l'adversaire
  // avait peut-être aussi cliqué "Demander validation" au même moment) ;
  // sinon, crée une ligne déjà résolue pour que son client soit notifié via
  // le même canal Realtime que d'habitude, sans avoir eu à cliquer.
  const { data: resolvedExisting } = await supabase
    .from("word_validation_votes")
    .update({ vote: true, voted_at: new Date().toISOString() })
    .eq("answer_id", match.id)
    .is("vote", null)
    .select()
    .maybeSingle();

  if (!resolvedExisting) {
    await supabase.from("word_validation_votes").insert({
      room_id: answer.room_id,
      round_id: answer.round_id,
      answer_id: match.id,
      word: match.word,
      categorie_id: answer.categorie_id,
      player_id: match.player_id,
      vote: true,
      voted_at: new Date().toISOString(),
    });
  }
}
