// constants/theme.ts - Thème unique de l'app (design "Petit Bac · iOS")
// Toutes les couleurs/espacements partagés vivent ici : un écran ne devrait
// jamais redéfinir sa propre palette.
// Source : maquette Claude Design "Petit Bac.dc.html" (iOS clair, accent indigo).

export const colors = {
  // Fonds (iOS system grouped background)
  bg: '#F2F2F7',
  bgDeep: '#E4E4EC',

  // Surfaces (cartes, inputs)
  surface: '#FFFFFF',
  surfaceStrong: '#EDEDF2',
  border: 'rgba(60, 60, 67, 0.15)',
  borderLight: 'rgba(60, 60, 67, 0.08)',

  // Couleur principale : indigo du design
  primary: '#5E5CE6',
  primaryDeep: '#5049C4',
  primaryLight: '#6E63F0',
  primarySoft: '#EBEBFB',
  primaryBorder: 'rgba(94, 92, 230, 0.35)',

  // "Or" du design = orange iOS (rangs, série, trophées)
  gold: '#FF9500',
  goldSoft: '#FFF0DE',
  goldBorder: 'rgba(255, 149, 0, 0.35)',
  // Ambre foncé lisible sur fond clair (badge "+5" du design)
  goldDeep: '#E0930C',
  goldDeepSoft: '#FFF3D6',

  success: '#34C759',
  successSoft: '#E3F7EA',
  successBorder: 'rgba(52, 199, 89, 0.5)',

  danger: '#FF3B30',
  dangerSoft: '#FFE9E7',
  dangerBorder: 'rgba(255, 59, 48, 0.45)',

  warning: '#FF9500',
  warningSoft: '#FFF0DE',
  warningBorder: 'rgba(255, 149, 0, 0.35)',

  // Accents secondaires (avatars, icônes, podium)
  pink: '#FF6B9F',
  pinkSoft: '#FDE7EF',
  peach: '#FF9F6B',
  purple: '#C84BC0',
  blue: '#5E8DEF',
  blueLight: '#8FB8FF',
  greenLight: '#7EE0B0',
  orangeLight: '#FFB43B',

  // Textes (iOS light)
  text: '#1C1C1E',
  textSecondary: '#8E8E93',
  textMuted: '#C7C7CC',

  // Texte/éléments posés sur les fonds colorés (héros, gradients)
  onPrimary: '#FFFFFF',
  onPrimarySecondary: 'rgba(255, 255, 255, 0.85)',
  onPrimaryMuted: 'rgba(255, 255, 255, 0.7)',
  onPrimarySurface: 'rgba(255, 255, 255, 0.22)',

  // Bouton désactivé (design : #D6D6DE, texte blanc)
  disabled: '#D6D6DE',
} as const;

// Dégradés du design (à utiliser avec expo-linear-gradient)
export const gradients = {
  // Héros / onboarding indigo
  primary: ['#6E63F0', '#5049C4'] as const,
  onboarding: ['#6E63F0', '#5E5CE6', '#4B49C9'] as const,
  // Tirage de lettre (orange → rose → violet)
  letter: ['#FF8A5B', '#FF6B9F', '#C84BC0'] as const,
  // Avatars
  sunset: ['#FF9F6B', '#FF6B9F'] as const,
  green: ['#7EE0B0', '#34C759'] as const,
  blue: ['#8FB8FF', '#5E8DEF'] as const,
  // Barre de chrono
  timer: ['#FFB43B', '#FF9500'] as const,
} as const;

// Typo display "Fredoka" (titres, lettres, chiffres) — chargée dans app/_layout.tsx
export const fonts = {
  display: 'Fredoka_600SemiBold',
  displayBold: 'Fredoka_700Bold',
  displayMedium: 'Fredoka_500Medium',
} as const;

export const radius = {
  sm: 10,
  md: 15,
  lg: 16,
  xl: 26,
  full: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

// Ombres du design (iOS) + elevation (Android)
export const shadow = {
  // Carte blanche : 0 4px 14px -8px rgba(0,0,0,0.2)
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  // Bouton / héros coloré : 0 14px 30px -10px rgba(color, 0.6)
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  }),
} as const;
