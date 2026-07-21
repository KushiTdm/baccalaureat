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

// Palette d'accents pour les avatars (rotation par rang, purement visuelle)
const AVATAR_COLORS = [
  colors.pink,
  colors.blue,
  colors.greenLight,
  colors.orangeLight,
  colors.purple,
  colors.peach,
];

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

  // Avatars colorés (maquette) : palette d'accents tournante par rang
  const avatarColor = (index: number) =>
    AVATAR_COLORS[index % AVATAR_COLORS.length];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Classement</Text>
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

          <View style={styles.listCard}>
            {entries.map((entry, index) => {
              const rank = index + 1;
              const isMe = !!user?.id && entry.id === user.id;
              const initial = entry.username?.trim().charAt(0).toUpperCase() || '?';
              return (
                <Animated.View
                  key={entry.id}
                  entering={FadeInDown.delay(Math.min(index, 10) * 50).springify()}
                  style={[
                    styles.row,
                    isMe && styles.rowMe,
                    index === entries.length - 1 && styles.rowLast,
                  ]}
                >
                  <Text style={[styles.rankText, { color: rankColor(rank) }, isMe && styles.textOnMe]}>
                    {rank}
                  </Text>

                  <View style={[styles.avatar, { backgroundColor: avatarColor(index) }, isMe && styles.avatarMe]}>
                    <Text style={[styles.avatarText, isMe && styles.avatarTextMe]}>{initial}</Text>
                  </View>

                  <View style={styles.nameColumn}>
                    <Text
                      style={[styles.username, isMe && styles.usernameMe]}
                      numberOfLines={1}
                    >
                      {isMe ? 'Toi' : entry.username}
                    </Text>
                    <Text style={[styles.victoriesText, isMe && styles.textOnMeMuted]}>
                      {entry.total_games_won} victoire{entry.total_games_won > 1 ? 's' : ''}
                    </Text>
                  </View>

                  <Text style={[styles.eloValue, isMe && styles.textOnMe]}>
                    {entry.elo_rating}
                  </Text>
                </Animated.View>
              );
            })}
          </View>

          {user && (
            <View style={styles.statsSection}>
              <Text style={styles.statsCaption}>Tes stats</Text>
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statCardValue}>{user.total_games_played}</Text>
                  <Text style={styles.statCardLabel}>Parties</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={[styles.statCardValue, styles.statCardValueSuccess]}>
                    {user.total_games_won}
                  </Text>
                  <Text style={styles.statCardLabel}>Victoires</Text>
                </View>
              </View>
            </View>
          )}
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
    paddingTop: 60,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  // Chevron nu au-dessus du grand titre (cohérent avec Réglages)
  backButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    marginLeft: -6,
    marginBottom: spacing.xs,
  },
  headerTitle: {
    fontSize: 30,
    fontFamily: fonts.displayBold,
    color: colors.text,
    letterSpacing: -0.3,
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
  // Liste : une seule carte, lignes séparées par un filet (maquette "Classement")
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  // "Ta ligne" du design : pilule indigo pleine, textes blancs, en pleine largeur
  rowMe: {
    backgroundColor: colors.primary,
    borderBottomWidth: 0,
    borderRadius: radius.md,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    ...shadow.glow(colors.primary),
  },
  rankText: {
    width: 22,
    fontSize: 16,
    fontFamily: fonts.displayBold,
    fontVariant: ['tabular-nums'],
  },
  // Avatar coloré avec initiale (maquette)
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarMe: {
    backgroundColor: colors.surface,
  },
  avatarText: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
    color: colors.onPrimary,
  },
  avatarTextMe: {
    color: colors.primary,
  },
  nameColumn: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  username: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  usernameMe: {
    color: colors.onPrimary,
    fontWeight: '800',
  },
  victoriesText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textOnMeMuted: {
    color: colors.onPrimarySecondary,
  },
  eloValue: {
    fontSize: 18,
    fontFamily: fonts.displayBold,
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  textOnMe: {
    color: colors.onPrimary,
  },
  // "Tes stats" (maquette) : deux cartes sous la liste
  statsSection: {
    marginTop: spacing.xl,
  },
  statsCaption: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    ...shadow.card,
  },
  statCardValue: {
    fontSize: 26,
    fontFamily: fonts.displayBold,
    color: colors.text,
    marginBottom: 2,
  },
  statCardValueSuccess: {
    color: colors.success,
  },
  statCardLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
});
