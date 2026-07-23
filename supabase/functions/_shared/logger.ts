// supabase/functions/_shared/logger.ts
//
// Journal d'erreurs persistant (table `app_logs`, voir
// database/logging-migration.sql) : consultable en SQL pour diagnostiquer un
// bug après coup, plutôt que de compter uniquement sur les logs éphémères de
// l'edge function (console.error, perdus après un moment et pas requêtables).
//
// Sert AUSSI de base au throttling des appels Gemini (waitForGeminiSlot) :
// chaque appel est journalisé avec un hash de la clé (jamais la clé en
// clair), ce qui permet de retrouver "quand ai-je appelé Gemini pour la
// dernière fois avec CETTE clé" sans jamais persister le secret lui-même.
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type LogLevel = "error" | "warn" | "info";

export async function hashKey(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(apiKey);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Insertion best-effort : ne doit JAMAIS faire échouer l'action en cours si
 * le logging lui-même échoue (table absente avant migration, réseau...).
 */
export async function log(
  supabase: SupabaseClient,
  entry: {
    source: string; // 'game-actions' | 'dictionary-enrich'
    level: LogLevel;
    action?: string;
    message: string;
    context?: Record<string, unknown>;
    apiKey?: string; // jamais stocké : uniquement haché
  }
): Promise<void> {
  try {
    await supabase.from("app_logs").insert({
      source: entry.source,
      level: entry.level,
      action: entry.action || null,
      message: entry.message.slice(0, 2000),
      context: entry.context ? entry.context : null,
      key_hash: entry.apiKey ? await hashKey(entry.apiKey) : null,
    });
  } catch (e) {
    console.error("Logging vers app_logs échoué (non bloquant):", e);
  }
}

// Le niveau gratuit de gemini-flash-latest tourne autour de ~10 requêtes/min
// (variable selon compte, cf aistudio.google.com/rate-limit) : on espace les
// appels d'une même clé d'au moins 7s pour rester avec une marge de sécurité
// et éviter un rejet 429 ("le modèle choisi" = gemini-flash-latest, seul
// modèle utilisé par ce projet).
const MIN_GEMINI_INTERVAL_MS = 7000;

/**
 * Attend, si nécessaire, que l'intervalle minimum se soit écoulé depuis le
 * dernier appel Gemini journalisé pour CETTE clé (retrouvé via son hash) —
 * les edge functions étant sans état entre invocations, ce suivi passe par
 * la table `app_logs` plutôt que par une variable en mémoire.
 */
export async function waitForGeminiSlot(supabase: SupabaseClient, apiKey: string): Promise<void> {
  const keyHash = await hashKey(apiKey);
  const { data } = await supabase
    .from("app_logs")
    .select("created_at")
    .eq("key_hash", keyHash)
    .eq("action", "gemini-call")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.created_at) {
    const elapsed = Date.now() - new Date(data.created_at).getTime();
    const remaining = MIN_GEMINI_INTERVAL_MS - elapsed;
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }
}
