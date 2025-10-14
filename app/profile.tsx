// app/profile.tsx
import { View, Text, StyleSheet, ScrollView, Alert, TextInput, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useUserStore } from '../store/userStore';
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
  Target, 
  TrendingUp, 
  Award,
  Mail,
  ArrowLeft,
  LogOut
} from 'lucide-react-native';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, setUsername, logout, refreshUser } = useUserStore();
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [loading, setLoading] = useState(false);

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
        {/* Header */}
        <Animated.View 
          entering={FadeInDown.delay(100).springify()}
          style={styles.header}
        >
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profil</Text>
          <TouchableOpacity 
            style={styles.logoutButton}
            onPress={handleLogout}
          >
            <LogOut size={22} color="#f44336" />
          </TouchableOpacity>
        </Animated.View>

        {/* Avatar et username */}
        <Animated.View 
          entering={FadeInDown.delay(200).springify()}
          style={styles.profileCard}
        >
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {user.username ? user.username.charAt(0).toUpperCase() : '?'}
              </Text>
            </View>
            {user.rank_position && user.rank_position <= 10 && (
              <View style={styles.rankBadge}>
                <Trophy size={16} color="#FFD700" />
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
                <Edit3 size={18} color="#007AFF" />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.eloContainer}>
            <Text style={styles.eloLabel}>ELO Rating</Text>
            <Text style={styles.eloValue}>{user.elo_rating}</Text>
          </View>
        </Animated.View>

        {/* Statistiques principales */}
        <Animated.View 
          entering={FadeInUp.delay(300).springify()}
          style={styles.statsGrid}
        >
          <View style={styles.statCard}>
            <Trophy size={28} color="#FFD700" />
            <Text style={styles.statValue}>{user.total_games_won}</Text>
            <Text style={styles.statLabel}>Victoires</Text>
          </View>

          <View style={styles.statCard}>
            <Target size={28} color="#4caf50" />
            <Text style={styles.statValue}>{user.total_games_played}</Text>
            <Text style={styles.statLabel}>Parties</Text>
          </View>

          <View style={styles.statCard}>
            <TrendingUp size={28} color="#2196f3" />
            <Text style={styles.statValue}>{winRate.toFixed(0)}%</Text>
            <Text style={styles.statLabel}>Victoires</Text>
          </View>

          <View style={styles.statCard}>
            <Award size={28} color="#ff9800" />
            <Text style={styles.statValue}>{user.total_points}</Text>
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

        {/* Section compte */}
        <Animated.View 
          entering={FadeInUp.delay(500)}
          style={styles.accountCard}
        >
          <Text style={styles.sectionTitle}>Compte</Text>

          <View style={styles.accountInfo}>
            <Mail size={20} color="rgba(255, 255, 255, 0.6)" />
            <View style={styles.accountInfoText}>
              <Text style={styles.accountLabel}>Email</Text>
              <Text style={styles.accountValue}>
                {user.email || 'Non lié'}
              </Text>
            </View>
          </View>

          {!user.email && (
            <Button
              title="Lier un email"
              onPress={() => Alert.alert('Bientôt disponible', 'Cette fonctionnalité sera disponible prochainement')}
              variant="secondary"
            />
          )}

          <View style={styles.accountInfo}>
            <Text style={styles.accountNote}>
              💡 Votre progression est automatiquement sauvegardée sur cet appareil
            </Text>
          </View>
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
    backgroundColor: '#0a0e27',
  },
  backgroundGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0a0e27',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
  },
  logoutButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#f44336',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  profileCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#007AFF',
  },
  avatarText: {
    fontSize: 42,
    fontWeight: '900',
    color: '#007AFF',
  },
  rankBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    borderRadius: 16,
    padding: 6,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 2,
    borderColor: '#FFD700',
  },
  rankText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFD700',
  },
  usernameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  username: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
  },
  editButton: {
    padding: 8,
  },
  editUsernameContainer: {
    width: '100%',
    marginBottom: 16,
  },
  usernameInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 14,
    fontSize: 18,
    color: '#fff',
    borderWidth: 2,
    borderColor: 'rgba(0, 122, 255, 0.3)',
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 12,
  },
  editButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  eloContainer: {
    alignItems: 'center',
  },
  eloLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 4,
    fontWeight: '600',
  },
  eloValue: {
    fontSize: 32,
    fontWeight: '900',
    color: '#007AFF',
    textShadowColor: 'rgba(0, 122, 255, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
  },
  detailedStatsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 16,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  statRowLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  statRowValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  accountCard: {
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.2)',
  },
  accountInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  accountInfoText: {
    flex: 1,
  },
  accountLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 2,
  },
  accountValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  accountNote: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  memberSinceCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  memberSinceText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '600',
  },
});