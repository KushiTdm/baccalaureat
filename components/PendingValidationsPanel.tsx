// components/PendingValidationsPanel.tsx
//
// Panneau PERSISTANT (pas un Alert.alert) listant toutes les demandes de
// validation manuelle encore sans réponse dans la room, toutes manches
// confondues. Remplace la dépendance à Alert.alert dans
// app/online-results.tsx : quand plusieurs demandes arrivent rapprochées,
// React Native ne garantit pas l'affichage de plusieurs boîtes de dialogue
// empilées — au-delà d'une ou deux, les suivantes sont silencieusement
// perdues et ne réapparaissent jamais (cause racine identifiée en base sur
// une vraie partie : les 3 premières demandes d'une manche passaient, les
// suivantes restaient bloquées à `vote = NULL` pour toujours).
//
// Alimenté par un polling de `websocketService.fetchPendingValidations`
// (lecture directe, sans Set de dédoublonnage) : une demande reste donc
// visible et actionnable tant qu'elle n'a pas de réponse, même si l'écran
// vient d'être (re)monté ou si l'événement Realtime d'origine a été loupé.
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useEffect, useState } from 'react';
import { Bell, HelpCircle } from 'lucide-react-native';
import { colors, fonts, radius, shadow } from '../constants/theme';
import { PendingValidationRow } from '../services/websocket';

// Délai avant qu'une demande sortante (la mienne) propose "Redemander" —
// aligné sur RESUBMIT_AFTER_MS côté edge function
// (supabase/functions/game-actions/index.ts), qui accepte une vraie relance
// passé ce délai.
const RESUBMIT_AFTER_MS = 20000;

interface Props {
  pending: PendingValidationRow[];
  myPlayerId: string;
  opponentName: string;
  onRespond: (voteId: string, approved: boolean) => void;
  onResubmit: (row: PendingValidationRow) => void;
}

export default function PendingValidationsPanel({ pending, myPlayerId, opponentName, onRespond, onResubmit }: Props) {
  // Re-render minute pour faire apparaître "Redemander" sans attendre le
  // prochain polling (purement cosmétique, aucun effet de bord).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (pending.length === 0) return;
    const id = setInterval(() => forceTick((n) => n + 1), 2000);
    return () => clearInterval(id);
  }, [pending.length]);

  if (pending.length === 0) return null;

  const incoming = pending.filter((p) => p.ownerId !== myPlayerId);
  const outgoing = pending.filter((p) => p.ownerId === myPlayerId);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Bell size={16} color={colors.goldDeep} />
        <Text style={styles.headerText}>
          {pending.length} validation{pending.length > 1 ? 's' : ''} en attente
        </Text>
      </View>

      {incoming.map((row) => (
        <View key={row.id} style={styles.card}>
          <Text style={styles.prompt}>
            {opponentName} pense que « {row.word} » est valide pour « {row.categorieName} »
            {row.roundNumber ? ` (manche ${row.roundNumber}${row.letter ? ` · ${row.letter}` : ''})` : ''}.
          </Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.actionButton, styles.noButton]} onPress={() => onRespond(row.id, false)}>
              <Text style={styles.noButtonText}>Non</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, styles.yesButton]} onPress={() => onRespond(row.id, true)}>
              <Text style={styles.yesButtonText}>Oui</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {outgoing.map((row) => {
        const elapsedMs = Date.now() - new Date(row.createdAt).getTime();
        const canResubmit = elapsedMs > RESUBMIT_AFTER_MS;
        return (
          <View key={row.id} style={styles.card}>
            <Text style={styles.prompt}>
              « {row.word} » — {row.categorieName}
              {row.roundNumber ? ` (manche ${row.roundNumber}${row.letter ? ` · ${row.letter}` : ''})` : ''}
            </Text>
            {canResubmit ? (
              <TouchableOpacity style={styles.resubmitButton} onPress={() => onResubmit(row)}>
                <HelpCircle size={13} color={colors.primary} />
                <Text style={styles.resubmitButtonText}>Toujours en attente — Redemander</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.waitingText}>En attente de {opponentName}...</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.goldDeep,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    gap: 8,
    ...shadow.card,
  },
  prompt: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  yesButton: {
    backgroundColor: colors.primary,
  },
  yesButtonText: {
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
  noButton: {
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noButtonText: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 13,
  },
  waitingText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  resubmitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primarySoft,
  },
  resubmitButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
});
