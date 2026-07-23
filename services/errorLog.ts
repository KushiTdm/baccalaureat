// services/errorLog.ts
//
// Écrit dans la même table `app_logs` que les edge functions
// (database/logging-migration.sql), pour que les erreurs côté app (BLE,
// Réglages...) apparaissent dans le même journal consultable que celles du
// serveur. Best-effort : ne doit jamais faire planter l'appelant si l'insert
// échoue (RLS pas encore migrée, hors-ligne...).
import { supabase } from '../lib/supabase';

export async function logAppError(
  action: string,
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('app_logs').insert({
      source: 'app',
      level: 'error',
      action,
      message: message.slice(0, 2000),
      context: context ?? null,
    });
  } catch {
    // best-effort, volontairement silencieux
  }
}
