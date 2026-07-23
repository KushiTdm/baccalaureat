// app/settings.tsx - Réglages de partie (durée, catégories, sons/vibrations)
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, ActivityIndicator, TextInput, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { ArrowLeft, Clock, Volume2, Vibrate, Sparkles } from 'lucide-react-native';
import { useSettingsStore, ROUND_DURATIONS } from '../store/settingsStore';
import { getCategories } from '../services/api';
import { Categorie, supabase } from '../lib/supabase';
import { GAME_LETTERS } from '../utils/letters';
import { testGeminiKey } from '../utils/geminiClient';
import { logAppError } from '../services/errorLog';
import { colors, fonts, radius, spacing, shadow } from '../constants/theme';

const ENRICH_COOLDOWN_BASE_MS = 15000;
// Espacement appliqué par generateWordsForLetter côté serveur (niveau
// gratuit gemini-flash-latest) : le cooldown local suit le même ordre de
// grandeur pour ne pas donner l'impression que le bouton est "cassé"
// pendant qu'un lot de plusieurs thèmes tourne encore côté serveur.
const ENRICH_PER_CATEGORY_MS = 7000;

export default function SettingsScreen() {
  const router = useRouter();
  const {
    roundDurationSec,
    disabledCategoryIds,
    soundsEnabled,
    hapticsEnabled,
    geminiApiKey,
    setRoundDuration,
    toggleCategory,
    setSoundsEnabled,
    setHapticsEnabled,
    setGeminiApiKey,
  } = useSettingsStore();

  const [categories, setCategories] = useState<Categorie[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);

  const [keyInput, setKeyInput] = useState(geminiApiKey);
  const [enrichLetter, setEnrichLetter] = useState(GAME_LETTERS[0]);
  // Vide = toutes les catégories (comportement par défaut de dictionary-enrich).
  const [enrichCategoryIds, setEnrichCategoryIds] = useState<number[]>([]);
  const [enriching, setEnriching] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [enrichSummary, setEnrichSummary] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    getCategories()
      .then(setCategories)
      .catch(() => setCategories([]))
      .finally(() => setLoadingCats(false));
  }, []);

  // `loadSettings()` (app/_layout.tsx, lecture AsyncStorage) est asynchrone et
  // peut résoudre APRÈS le montage de cet écran : `useState(geminiApiKey)`
  // n'aurait alors capturé qu'une valeur encore vide, sans se remettre à jour
  // quand le store se peuple ensuite — la clé semblait "ne pas être
  // mémorisée" alors qu'elle l'était bien en local. On resynchronise dès que
  // le store reçoit une clé, sans écraser une saisie déjà en cours.
  useEffect(() => {
    if (!keyInput && geminiApiKey) {
      setKeyInput(geminiApiKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geminiApiKey]);

  // Réaffiche le bouton "Générer des mots" une fois le cooldown écoulé.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setTimeout(() => forceTick((n) => n + 1), cooldownUntil - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [cooldownUntil]);

  const onCooldown = cooldownUntil > Date.now();

  const toggleEnrichCategory = (id: number) => {
    setEnrichCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleTestKey = async () => {
    const key = keyInput.trim();
    if (!key) {
      Alert.alert('Clé Gemini requise', 'Colle une clé avant de la tester.');
      return;
    }
    setGeminiApiKey(key);
    setTestingKey(true);
    setKeyTestResult(null);
    try {
      const result = await testGeminiKey(key);
      setKeyTestResult(result);
      if (!result.ok) {
        logAppError('gemini-key-test', result.message);
      }
    } finally {
      setTestingKey(false);
    }
  };

  const handleEnrich = async () => {
    // On utilise le champ local (keyInput), pas le store : ce dernier n'est
    // mis à jour qu'au blur du TextInput (onBlur), donc si l'utilisateur
    // tape sa clé puis appuie directement sur le bouton sans faire perdre le
    // focus au champ, `geminiApiKey` (store) était encore vide et le bouton
    // — désactivé sur cette même condition — restait bloqué non cliquable.
    const key = keyInput.trim();
    if (!key) {
      Alert.alert('Clé Gemini requise', "L'ajout de mots au dictionnaire n'est disponible qu'avec une clé API valide.");
      return;
    }
    setGeminiApiKey(key);
    setEnriching(true);
    setEnrichSummary(null);
    const targetCount = enrichCategoryIds.length > 0 ? enrichCategoryIds.length : categories.length || 1;
    try {
      const { data, error } = await supabase.functions.invoke('dictionary-enrich', {
        body: {
          geminiApiKey: key,
          letter: enrichLetter,
          categorieIds: enrichCategoryIds.length > 0 ? enrichCategoryIds : undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const total = data?.totalAccepted ?? 0;
      const themeLabel =
        enrichCategoryIds.length > 0
          ? categories.filter((c) => enrichCategoryIds.includes(c.id)).map((c) => c.nom).join(', ')
          : 'toutes catégories';
      setEnrichSummary(`${total} mot(s) ajouté(s) pour la lettre ${enrichLetter} (${themeLabel}).`);
    } catch (e) {
      const message = (e as Error).message || 'échec de la génération';
      setEnrichSummary(`Erreur : ${message}`);
      logAppError('dictionary-enrich-client', message, { letter: enrichLetter, categorieIds: enrichCategoryIds });
    } finally {
      setEnriching(false);
      // Le serveur espace déjà chaque catégorie d'~7s (niveau gratuit) : le
      // cooldown local suit la même durée totale pour rester cohérent.
      setCooldownUntil(Date.now() + Math.max(ENRICH_COOLDOWN_BASE_MS, targetCount * ENRICH_PER_CATEGORY_MS));
    }
  };

  const enabledCount = categories.filter((c) => !disabledCategoryIds.includes(c.id)).length;

  // Format "Chrono" façon maquette : minutes rondes en mm:ss (1:00, 2:00...)
  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Nouvelle partie</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Durée de manche */}
        <Animated.View entering={FadeInDown.delay(100).springify()}>
          <Text style={styles.sectionCaption}>Durée de la manche</Text>
          <View style={styles.card}>
            <View style={styles.chronoHeaderRow}>
              <View style={styles.chronoLabelRow}>
                <Clock size={20} color={colors.primary} />
                <Text style={styles.chronoLabel}>Chrono</Text>
              </View>
              <Text style={styles.chronoValue}>{formatDuration(roundDurationSec)}</Text>
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
                    {sec / 60} min
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.cardHint}>
              S'applique au mode solo et aux parties en ligne que vous lancez.
            </Text>
          </View>
        </Animated.View>

        {/* Catégories */}
        <Animated.View entering={FadeInUp.delay(200).springify()}>
          <View style={styles.sectionCaptionRow}>
            <Text style={styles.sectionCaption}>Catégories · {enabledCount}</Text>
          </View>
          <Text style={styles.categoriesHint}>
            En ligne, les catégories restent communes aux deux joueurs.
          </Text>

          {loadingCats ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
          ) : (
            <View style={styles.categoriesWrap}>
              {categories.map((category) => {
                const enabled = !disabledCategoryIds.includes(category.id);
                return (
                  <TouchableOpacity
                    key={category.id}
                    style={[styles.categoryChip, enabled && styles.categoryChipActive]}
                    onPress={() => toggleCategory(category.id)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        enabled && styles.categoryChipTextActive,
                      ]}
                    >
                      {category.nom}{enabled ? ' +' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </Animated.View>

        {/* Sons & vibrations */}
        <Animated.View entering={FadeInDown.delay(300).springify()} style={[styles.card, styles.togglesCard]}>
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
          <View style={[styles.toggleRow, styles.toggleRowDivider]}>
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

        {/* Dictionnaire (IA) */}
        <Animated.View entering={FadeInUp.delay(400).springify()}>
          <Text style={styles.sectionCaption}>Dictionnaire (IA)</Text>
          <View style={styles.card}>
            <View style={styles.chronoLabelRow}>
              <Sparkles size={20} color={colors.primary} />
              <Text style={styles.chronoLabel}>Clé Gemini</Text>
            </View>
            <Text style={styles.cardHint}>
              Récupère une clé gratuite sur aistudio.google.com. Elle reste uniquement sur cet
              appareil (jamais envoyée ailleurs qu'à Google/Supabase pour ces requêtes) et active
              l'ajout de mots au dictionnaire — validés par l'IA, jamais directement par un joueur.
            </Text>
            <TextInput
              style={styles.keyInput}
              value={keyInput}
              onChangeText={(text) => {
                setKeyInput(text);
                setKeyTestResult(null);
              }}
              onBlur={() => setGeminiApiKey(keyInput)}
              placeholder="Coller la clé API Gemini ici"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.testKeyButton, (testingKey || !keyInput.trim()) && styles.enrichButtonDisabled]}
              onPress={handleTestKey}
              disabled={testingKey || !keyInput.trim()}
            >
              {testingKey ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text style={styles.testKeyButtonText}>Tester la clé</Text>
              )}
            </TouchableOpacity>
            {keyTestResult && (
              <Text style={keyTestResult.ok ? styles.keyTestOk : styles.keyTestError}>
                {keyTestResult.ok ? '✅ ' : '❌ '}
                {keyTestResult.message}
              </Text>
            )}

            <Text style={[styles.cardHint, { marginTop: spacing.lg }]}>Lettre à enrichir</Text>
            <View style={styles.categoriesWrap}>
              {GAME_LETTERS.map((l) => (
                <TouchableOpacity
                  key={l}
                  style={[styles.categoryChip, enrichLetter === l && styles.categoryChipActive]}
                  onPress={() => setEnrichLetter(l)}
                >
                  <Text style={[styles.categoryChipText, enrichLetter === l && styles.categoryChipTextActive]}>
                    {l}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.cardHint, { marginTop: spacing.lg }]}>
              Thème (aucune sélection = toutes catégories)
            </Text>
            <View style={styles.categoriesWrap}>
              {categories.map((c) => {
                const active = enrichCategoryIds.includes(c.id);
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.categoryChip, active && styles.categoryChipActive]}
                    onPress={() => toggleEnrichCategory(c.id)}
                  >
                    <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                      {c.nom}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.enrichButton, (enriching || onCooldown || !keyInput.trim()) && styles.enrichButtonDisabled]}
              onPress={handleEnrich}
              disabled={enriching || onCooldown || !keyInput.trim()}
            >
              {enriching ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.enrichButtonText}>
                  {onCooldown ? 'Patiente quelques secondes...' : 'Générer des mots'}
                </Text>
              )}
            </TouchableOpacity>

            {enrichSummary && <Text style={styles.enrichSummary}>{enrichSummary}</Text>}
          </View>
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
    paddingTop: 60,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  // Chevron nu (sans fond) posé au-dessus du grand titre, façon maquette
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
  scrollContent: {
    padding: spacing.xl,
    paddingTop: 0,
    paddingBottom: 40,
    gap: spacing.xl,
  },
  sectionCaptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionCaption: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  categoriesHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    ...shadow.card,
  },
  togglesCard: {
    padding: 0,
    paddingHorizontal: spacing.xl,
  },
  chronoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  chronoLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chronoLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  chronoValue: {
    fontSize: 20,
    fontFamily: fonts.displayBold,
    color: colors.primary,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  cardHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.md,
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
  // Catégories : puces (chips) directement sur le fond, façon maquette
  categoriesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryChip: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceStrong,
  },
  categoryChipActive: {
    backgroundColor: colors.primary,
    ...shadow.glow(colors.primary),
  },
  categoryChipText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  categoryChipTextActive: {
    color: colors.onPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
  },
  toggleRowDivider: {
    borderTopWidth: 0.5,
    borderTopColor: colors.borderLight,
  },
  toggleLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  keyInput: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.text,
  },
  testKeyButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primarySoft,
  },
  testKeyButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  keyTestOk: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.success,
    fontWeight: '600',
  },
  keyTestError: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.danger,
    fontWeight: '600',
  },
  enrichButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enrichButtonDisabled: {
    opacity: 0.5,
  },
  enrichButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  enrichSummary: {
    marginTop: spacing.md,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
