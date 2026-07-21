// app/profile.tsx
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { useUserStore } from '../store/userStore';
import { getSoloHistory, SoloGameSummary } from '../services/stats';
import Button from '../components/Button';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  SlideInRight,
} from 'react-native-reanimated';
import {
  User,
  Edit3,
  Trophy,
  Mail,
  ArrowLeft,
  LogOut,
  ChevronRight,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients, fonts, radius, spacing, shadow } from '../constants/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, setUsername, logout, refreshUser } = useUserStore();
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<SoloGameSummary[]>([]);

  useEffect(() => {
    if (user?.id) {
      getSoloHistory(user.id).then(setHistory);
    }
  }, [user?.id]);

  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Utilisateur non connecté</Text>
        <Button title="Retour" onPress={() => router.back()} />
      </View>
    );
  }

  async function handleUpdateUsername() {
    if (!newUsername.trim() || newUsername === user.username) {
      setIsEditingUsername(false);
      return;
    }

    setLoading(true);
    try {
      await setUsername(newUsername.trim());
      setIsEditingUsername(false);
      Alert.alert('Succès', 'Pseudo mis à jour avec succès');
    } catch (error: any) {
      Alert.alert('Erreur', error.message || 'Impossible de modifier le pseudo');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    Alert.alert(
      'Déconnexion',
      'Êtes-vous sûr de vouloir vous déconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Déconnexion',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/');
          },
        },
      ]
    );
  }

  const winRate = user.win_rate || 0;
  const avgPointsPerGame = user.total_games_played > 0
    ? Math.round(user.total_points / user.total_games_played)
    : 0;

  return (
    <View style={styles.container}>
      <Animated.View 
        entering={FadeIn.duration(600)}
        style={styles.backgroundGradient}
      />

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header : simple chevron, sans titre ni action (maquette "Profil") */}
        <Animated.View
          entering={FadeInDown.delay(100).springify()}
          style={styles.header}
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color={colors.primary} />
          </TouchableOpacity>
        </Animated.View>

        {/* Avatar et username */}
        <Animated.View
          entering={FadeInDown.delay(200).springify()}
          style={styles.profileCard}
        >
          <View style={styles.avatarContainer}>
            <LinearGradient
              colors={gradients.sunset}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>
                {user.username ? user.username.charAt(0).toUpperCase() : '?'}
              </Text>
            </LinearGradient>
            {user.rank_position && user.rank_position <= 10 && (
              <View style={styles.rankBadge}>
                <Trophy size={16} color={colors.goldDeep} />
                <Text style={styles.rankText}>#{user.rank_position}</Text>
              </View>
            )}
          </View>

          {isEditingUsername ? (
            <View style={styles.editUsernameContainer}>
              <TextInput
                style={styles.usernameInput}
                value={newUsername}
                onChangeText={setNewUsername}
                maxLength={20}
                autoFocus
                onSubmitEditing={handleUpdateUsername}
              />
              <View style={styles.editButtons}>
                <Button
                  title="Annuler"
                  onPress={() => {
                    setNewUsername(user.username || '');
                    setIsEditingUsername(false);
                  }}
                  variant="secondary"
                />
                <Button
                  title="Enregistrer"
                  onPress={handleUpdateUsername}
                  loading={loading}
                />
              </View>
            </View>
          ) : (
            <View style={styles.usernameContainer}>
              <Text style={styles.username}>{user.username || 'Sans pseudo'}</Text>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => setIsEditingUsername(true)}
              >
                <Edit3 size={18} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}

          {/* Ligne meta condensée (maquette : "@handle · Niveau · Rang") avec nos vraies données */}
          <Text style={styles.metaLine}>
            ELO {user.elo_rating}
            {user.rank_position ? ` · Rang #${user.rank_position}` : ''}
          </Text>
        </Animated.View>

        {/* Statistiques principales : une seule ligne de 3 cartes (maquette) */}
        <Animated.View
          entering={FadeInUp.delay(300).springify()}
          style={styles.statsGrid}
        >
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{user.total_games_played}</Text>
            <Text style={styles.statLabel}>Parties</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={[styles.statValue, styles.statValueSuccess]}>{winRate.toFixed(0)}%</Text>
            <Text style={styles.statLabel}>Victoires</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={[styles.statValue, styles.statValueGold]}>{user.total_points}</Text>
            <Text style={styles.statLabel}>Points</Text>
          </View>
        </Animated.View>

        {/* Statistiques détaillées */}
        <Animated.View 
          entering={SlideInRight.delay(400).springify()}
          style={styles.detailedStatsCard}
        >
          <Text style={styles.sectionTitle}>Statistiques détaillées</Text>

          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Victoires</Text>
            <Text style={styles.statRowValue}>{user.total_games_won}</Text>
          </View>

          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Meilleur score (manche)</Text>
            <Text style={styles.statRowValue}>{user.best_round_score} pts</Text>
          </View>

          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Meilleur score (partie)</Text>
            <Text style={styles.statRowValue}>{user.best_game_score} pts</Text>
          </View>

          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Mots valides trouvés</Text>
            <Text style={styles.statRowValue}>{user.total_valid_words}</Text>
          </View>

          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Points moyens/partie</Text>
            <Text style={styles.statRowValue}>{avgPointsPerGame}</Text>
          </View>

          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Défaites</Text>
            <Text style={styles.statRowValue}>{user.total_games_lost}</Text>
          </View>

          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Égalités</Text>
            <Text style={styles.statRowValue}>{user.total_games_draw}</Text>
          </View>
        </Animated.View>

        {/* Historique des parties solo */}
        {history.length > 0 && (
          <Animated.View
            entering={FadeInUp.delay(450)}
            style={styles.detailedStatsCard}
          >
            <Text style={styles.sectionTitle}>Dernières parties solo</Text>
            {history.map((game) => (
              <View key={game.id} style={styles.statRow}>
                <View style={styles.historyLetterBadge}>
                  <Text style={styles.historyLetterText}>{game.lettre.toUpperCase()}</Text>
                </View>
                <Text style={styles.historyDate}>
                  {new Date(game.date_jeu).toLocaleDateString('fr-FR')}
                </Text>
                <Text style={styles.statRowValue}>{game.score} pts</Text>
              </View>
            ))}
          </Animated.View>
        )}

        {/* Section compte : liste icône + libellé + chevron (maquette "Profil") */}
        <Animated.View
          entering={FadeInUp.delay(500)}
          style={styles.accountCard}
        >
          <Text style={styles.sectionTitle}>Compte</Text>

          <View style={styles.listRow}>
            <View style={[styles.iconTile, { backgroundColor: colors.primarySoft }]}>
              <Mail size={18} color={colors.primary} />
            </View>
            <Text style={styles.listRowLabel}>Email</Text>
            <Text style={styles.listRowValue} numberOfLines={1}>
              {user.email || 'Non lié'}
            </Text>
          </View>

          {!user.email && (
            <TouchableOpacity
              style={styles.listRow}
              onPress={() => Alert.alert('Bientôt disponible', 'Cette fonctionnalité sera disponible prochainement')}
            >
              <View style={[styles.iconTile, { backgroundColor: colors.goldSoft }]}>
                <Mail size={18} color={colors.goldDeep} />
              </View>
              <Text style={styles.listRowLabel}>Lier un email</Text>
              <ChevronRight size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.listRow, styles.listRowLast]}
            onPress={handleLogout}
          >
            <View style={[styles.iconTile, { backgroundColor: colors.dangerSoft }]}>
              <LogOut size={18} color={colors.danger} />
            </View>
            <Text style={[styles.listRowLabel, styles.listRowLabelDanger]}>Déconnexion</Text>
            <ChevronRight size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <Text style={styles.accountNote}>
            💡 Votre progression est automatiquement sauvegardée sur cet appareil
          </Text>
        </Animated.View>

        {/* Membre depuis */}
        <Animated.View 
          entering={FadeIn.delay(600)}
          style={styles.memberSinceCard}
        >
          <Text style={styles.memberSinceText}>
            Membre depuis le {new Date(user.created_at).toLocaleDateString('fr-FR')}
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  // Pas de titre ni d'action dans l'en-tête (maquette "Profil") : juste un retour
  header: {
    marginBottom: 8,
  },
  backButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    marginLeft: -6,
  },
  errorText: {
    color: colors.danger,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  profileCard: {
    borderRadius: radius.xl,
    padding: 24,
    marginBottom: 20,
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  // Avatar dégradé "sunset" du design
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow.glow(colors.pink),
  },
  avatarText: {
    fontSize: 38,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  rankBadge: {
    position: 'absolute',
    bottom: 0,
    right: -6,
    backgroundColor: colors.goldDeepSoft,
    borderRadius: 16,
    padding: 6,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rankText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.goldDeep,
  },
  usernameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  username: {
    fontSize: 26,
    fontFamily: fonts.display,
    color: colors.text,
  },
  editButton: {
    padding: 8,
  },
  editUsernameContainer: {
    width: '100%',
    marginBottom: 16,
  },
  usernameInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 18,
    color: colors.text,
    borderWidth: 2,
    borderColor: colors.primaryBorder,
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 12,
  },
  editButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  // Ligne meta condensée sous le pseudo (maquette : "@handle · Niveau · Rang")
  metaLine: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  // Une seule ligne de 3 cartes (maquette), au lieu d'une grille 2x2
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 20,
    alignItems: 'center',
    ...shadow.card,
  },
  statValue: {
    fontSize: 24,
    fontFamily: fonts.displayBold,
    color: colors.text,
    marginBottom: 4,
  },
  statValueSuccess: {
    color: colors.success,
  },
  statValueGold: {
    color: colors.gold,
  },
  statLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  detailedStatsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 20,
    marginBottom: 20,
    ...shadow.card,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
  },
  statRowLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  statRowValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  historyLetterBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  historyLetterText: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
    color: colors.primary,
  },
  historyDate: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 12,
  },
  // Carte blanche + liste icône/libellé/chevron (maquette "Profil")
  accountCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 20,
    marginBottom: 20,
    ...shadow.card,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
  },
  listRowLast: {
    borderBottomWidth: 0,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listRowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  listRowLabelDanger: {
    color: colors.danger,
  },
  listRowValue: {
    fontSize: 14,
    color: colors.textSecondary,
    maxWidth: '45%',
  },
  accountNote: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
    fontStyle: 'italic',
    marginTop: 12,
  },
  memberSinceCard: {
    borderRadius: radius.md,
    padding: 16,
    alignItems: 'center',
  },
  memberSinceText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '600',
  },
});