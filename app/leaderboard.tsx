// app/leaderboard.tsx - Classement en ligne (top 50, vue SQL `leaderboard`)
// Affiche rang / pseudo / ELO / victoires, surligne la ligne de l'utilisateur
// courant. États chargement / erreur (hors ligne) / vide gérés proprement.
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ArrowLeft, Trophy, WifiOff, RefreshCw } from 'lucide-react-native';
import { userService, LeaderboardEntry } from '../services/user';
import { useUserStore } from '../store/userStore';
import { colors, fonts, radius, spacing, shadow } from '../constants/theme';

export default function LeaderboardScreen() {
  const router = useRouter();
  const { user } = useUserStore();

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await userService.getLeaderboard(50);
      setEntries(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  // Couleur du rang : or / argent / bronze pour le podium
  const rankColor = (rank: number) => {
    if (rank === 1) return colors.gold;
    if (rank === 2) return colors.textSecondary;
    if (rank === 3) return colors.goldDeep;
    return colors.textMuted;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Classement</Text>
        <View style={styles.backButton} />
      </View>

      {loading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.stateText}>Chargement du classement...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerContent}>
          <WifiOff size={48} color={colors.textMuted} />
          <Text style={styles.stateTitle}>Classement indisponible hors ligne</Text>
          <Text style={styles.stateText}>
            Vérifiez votre connexion puis réessayez.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadLeaderboard}>
            <RefreshCw size={18} color={colors.primary} />
            <Text style={styles.retryText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.centerContent}>
          <Trophy size={48} color={colors.textMuted} />
          <Text style={styles.stateTitle}>Aucun joueur classé</Text>
          <Text style={styles.stateText}>
            Jouez des parties en ligne pour apparaître dans le classement !
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.springify()} style={styles.podiumBadge}>
            <Trophy size={22} color={colors.gold} />
            <Text style={styles.podiumText}>Top {entries.length} joueurs</Text>
          </Animated.View>

          {/* En-tête des colonnes */}
          <View style={styles.columnsHeader}>
            <Text style={[styles.columnLabel, styles.rankColumn]}>#</Text>
            <Text style={[styles.columnLabel, styles.nameColumn]}>Joueur</Text>
            <Text style={[styles.columnLabel, styles.statColumn]}>ELO</Text>
            <Text style={[styles.columnLabel, styles.statColumn]}>Victoires</Text>
          </View>

          {entries.map((entry, index) => {
            const rank = index + 1;
            const isMe = !!user?.id && entry.id === user.id;
            return (
              <Animated.View
                key={entry.id}
                entering={FadeInDown.delay(Math.min(index, 10) * 50).springify()}
                style={[styles.row, isMe && styles.rowMe]}
              >
                <View style={styles.rankColumn}>
                  <Text style={[styles.rankText, { color: rankColor(rank) }, isMe && styles.textOnMe]}>
                    {rank}
                  </Text>
                </View>
                <View style={styles.nameColumn}>
                  <Text
                    style={[styles.username, isMe && styles.usernameMe]}
                    numberOfLines={1}
                  >
                    {entry.username}
                    {isMe ? ' (vous)' : ''}
                  </Text>
                </View>
                <Text style={[styles.statValue, styles.statColumn, styles.eloValue, isMe && styles.textOnMe]}>
                  {entry.elo_rating}
                </Text>
                <Text style={[styles.statValue, styles.statColumn, isMe && styles.textOnMe]}>
                  {entry.total_games_won}
                </Text>
              </Animated.View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: fonts.display,
    color: colors.text,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  stateText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 40,
    gap: spacing.sm,
  },
  podiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.goldSoft,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  podiumText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.goldDeep,
  },
  columnsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  columnLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  // "Ta ligne" du design : carte indigo pleine, textes blancs
  rowMe: {
    backgroundColor: colors.primary,
    ...shadow.glow(colors.primary),
  },
  rankColumn: {
    width: 34,
  },
  rankText: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
    fontVariant: ['tabular-nums'],
  },
  nameColumn: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  username: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  usernameMe: {
    color: colors.onPrimary,
    fontWeight: '800',
  },
  statColumn: {
    width: 68,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  eloValue: {
    color: colors.primary,
  },
  textOnMe: {
    color: colors.onPrimary,
  },
});
