// app/settings.tsx - Réglages de partie (durée, catégories, sons/vibrations)
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { ArrowLeft, Clock, ListChecks, Volume2, Vibrate } from 'lucide-react-native';
import { useSettingsStore, ROUND_DURATIONS } from '../store/settingsStore';
import { getCategories } from '../services/api';
import { Categorie } from '../lib/supabase';
import { colors, fonts, radius, spacing, shadow } from '../constants/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const {
    roundDurationSec,
    disabledCategoryIds,
    soundsEnabled,
    hapticsEnabled,
    setRoundDuration,
    toggleCategory,
    setSoundsEnabled,
    setHapticsEnabled,
  } = useSettingsStore();

  const [categories, setCategories] = useState<Categorie[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);

  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch(() => setCategories([]))
      .finally(() => setLoadingCats(false));
  }, []);

  const enabledCount = categories.filter((c) => !disabledCategoryIds.includes(c.id)).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Réglages</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Durée de manche */}
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.card}>
          <View style={styles.cardHeader}>
            <Clock size={22} color={colors.primary} />
            <Text style={styles.cardTitle}>Durée de manche</Text>
          </View>
          <View style={styles.durationRow}>
            {ROUND_DURATIONS.map((sec) => (
              <TouchableOpacity
                key={sec}
                style={[styles.durationChip, roundDurationSec === sec && styles.durationChipActive]}
                onPress={() => setRoundDuration(sec)}
              >
                <Text
                  style={[
                    styles.durationText,
                    roundDurationSec === sec && styles.durationTextActive,
                  ]}
                >
                  {sec < 120 ? `${sec} s` : `${sec / 60} min`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.cardHint}>
            S'applique au mode solo et aux parties en ligne que vous lancez.
          </Text>
        </Animated.View>

        {/* Sons & vibrations */}
        <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabel}>
              <Volume2 size={22} color={colors.primary} />
              <Text style={styles.cardTitle}>Sons</Text>
            </View>
            <Switch
              value={soundsEnabled}
              onValueChange={setSoundsEnabled}
              trackColor={{ false: colors.bgDeep, true: colors.success }}
              thumbColor={colors.surface}
            />
          </View>
          <View style={[styles.toggleRow, { marginTop: spacing.lg }]}>
            <View style={styles.toggleLabel}>
              <Vibrate size={22} color={colors.primary} />
              <Text style={styles.cardTitle}>Vibrations</Text>
            </View>
            <Switch
              value={hapticsEnabled}
              onValueChange={setHapticsEnabled}
              trackColor={{ false: colors.bgDeep, true: colors.success }}
              thumbColor={colors.surface}
            />
          </View>
        </Animated.View>

        {/* Catégories */}
        <Animated.View entering={FadeInUp.delay(300).springify()} style={styles.card}>
          <View style={styles.cardHeader}>
            <ListChecks size={22} color={colors.primary} />
            <Text style={styles.cardTitle}>Catégories (solo)</Text>
          </View>
          <Text style={styles.cardHint}>
            {enabledCount}/{categories.length} catégories actives. En ligne, les
            catégories restent communes aux deux joueurs.
          </Text>

          {loadingCats ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
          ) : (
            categories.map((category) => {
              const enabled = !disabledCategoryIds.includes(category.id);
              return (
                <View key={category.id} style={styles.categoryRow}>
                  <Text style={styles.categoryName}>{category.nom}</Text>
                  <Switch
                    value={enabled}
                    onValueChange={() => toggleCategory(category.id)}
                    trackColor={{ false: colors.bgDeep, true: colors.success }}
                    thumbColor={colors.surface}
                  />
                </View>
              );
            })
          )}
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
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  scrollContent: {
    padding: spacing.xl,
    paddingTop: 0,
    paddingBottom: 40,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    ...shadow.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  cardHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  durationRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  // Pastilles du design : pilule indigo pleine quand actif, grise sinon
  durationChip: {
    flex: 1,
    paddingVertical: spacing.sm + 1,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceStrong,
    alignItems: 'center',
  },
  durationChipActive: {
    backgroundColor: colors.primary,
    ...shadow.glow(colors.primary),
  },
  durationText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  durationTextActive: {
    color: colors.onPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
  },
  categoryName: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
  },
});
