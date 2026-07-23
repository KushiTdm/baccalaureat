// supabase/functions/dictionary-enrich/index.ts
//
// Enrichissement en lot du dictionnaire par IA (Gemini, niveau gratuit).
// Déclenché depuis l'écran Réglages de l'app (bouton « Générer des mots »),
// avec une clé Gemini saisie et stockée localement sur l'appareil (jamais
// commitée, jamais bundlée) — seul un utilisateur possédant une clé valide
// peut faire grandir le dictionnaire par ce biais. Les joueurs normaux ne
// peuvent jamais ajouter de mot directement (voir game-actions pour le
// second canal d'ajout : validation mutuelle + gate IA de fin de manche).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateWordsForLetter, isSafeCandidateWord, normalizeWordForCheck } from "../_shared/gemini.ts";
import { log } from "../_shared/logger.ts";

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

type CategoryResult = {
  categorieId: number;
  categorieName: string;
  proposed: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  error?: string;
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
    const geminiApiKey: string = body?.geminiApiKey;
    const letter: string = body?.letter;
    const categorieIds: number[] | undefined = Array.isArray(body?.categorieIds) ? body.categorieIds : undefined;

    if (!geminiApiKey || typeof geminiApiKey !== "string") {
      return json({ error: "Clé Gemini manquante" }, 400);
    }
    if (!letter || typeof letter !== "string" || letter.length !== 1 || !/^[a-zA-ZÀ-ÿ]$/.test(letter)) {
      return json({ error: "Lettre invalide" }, 400);
    }

    const { data: allCategories, error: catError } = await supabase.from("categories").select("id, nom");
    if (catError) throw catError;
    if (!allCategories || allCategories.length === 0) {
      return json({ error: "Aucune catégorie trouvée" }, 400);
    }

    const targetCategories =
      categorieIds && categorieIds.length > 0
        ? allCategories.filter((c) => categorieIds.includes(c.id))
        : allCategories;

    const results: CategoryResult[] = [];
    let totalAccepted = 0;

    for (const cat of targetCategories) {
      const { data: existing } = await supabase
        .from("mots")
        .select("mot_normalized")
        .eq("categorie_id", cat.id)
        .ilike("mot_normalized", `${letter.toLowerCase()}%`);
      const excludeSet = new Set((existing || []).map((m) => m.mot_normalized));

      // generateWordsForLetter espace lui-même les appels Gemini (throttling
      // niveau gratuit via _shared/logger.ts#waitForGeminiSlot) : pas besoin
      // d'ajouter un délai ici, même avec plusieurs catégories dans la boucle.
      let proposed: string[] = [];
      try {
        proposed = await generateWordsForLetter(supabase, geminiApiKey, {
          letter,
          categorieName: cat.nom,
          exclude: Array.from(excludeSet),
        });
      } catch (e) {
        results.push({
          categorieId: cat.id,
          categorieName: cat.nom,
          proposed: 0,
          accepted: 0,
          duplicates: 0,
          rejected: 0,
          error: (e as Error).message,
        });
        continue;
      }

      let duplicates = 0;
      let rejected = 0;
      const rows: { mot: string; mot_normalized: string; categorie_id: number }[] = [];

      for (const w of proposed) {
        if (!isSafeCandidateWord(w, letter)) {
          rejected++;
          continue;
        }
        const norm = normalizeWordForCheck(w);
        if (excludeSet.has(norm)) {
          duplicates++;
          continue;
        }
        excludeSet.add(norm);
        rows.push({ mot: w.trim(), mot_normalized: norm, categorie_id: cat.id });
      }

      let accepted = 0;
      if (rows.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from("mots")
          .upsert(rows, { onConflict: "mot_normalized,categorie_id", ignoreDuplicates: true })
          .select("id");
        if (insertError) throw insertError;
        accepted = inserted?.length || 0;
      }

      totalAccepted += accepted;
      results.push({
        categorieId: cat.id,
        categorieName: cat.nom,
        proposed: proposed.length,
        accepted,
        duplicates,
        rejected: rejected + (rows.length - accepted),
      });
    }

    return json({ letter, results, totalAccepted });
  } catch (error) {
    console.error("dictionary-enrich error:", error);
    await log(supabase, {
      source: "dictionary-enrich",
      level: "error",
      action: "dictionary-enrich",
      message: (error as Error).message || String(error),
    });
    return json({ error: (error as Error).message || "Erreur serveur" }, 500);
  }
});
