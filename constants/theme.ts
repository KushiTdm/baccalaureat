// constants/theme.ts - Thème unique de l'app (sombre)
// Toutes les couleurs/espacements partagés vivent ici : un écran ne devrait
// jamais redéfinir sa propre palette.

export const colors = {
  // Fonds
  bg: '#0a0e27',
  bgDeep: '#050816',

  // Surfaces (cartes, inputs)
  surface: 'rgba(255, 255, 255, 0.06)',
  surfaceStrong: 'rgba(255, 255, 255, 0.1)',
  border: 'rgba(255, 255, 255, 0.12)',
  borderLight: 'rgba(255, 255, 255, 0.08)',

  // Couleurs principales (mêmes valeurs que les couleurs historiques des
  // écrans pour rester cohérent avec les icônes codées en dur)
  primary: '#007AFF',
  primarySoft: 'rgba(0, 122, 255, 0.15)',
  primaryBorder: 'rgba(0, 122, 255, 0.35)',

  gold: '#FFD700',
  goldSoft: 'rgba(255, 215, 0, 0.12)',
  goldBorder: 'rgba(255, 215, 0, 0.35)',

  success: '#4caf50',
  successSoft: 'rgba(76, 175, 80, 0.15)',
  successBorder: 'rgba(76, 175, 80, 0.5)',

  danger: '#f44336',
  dangerSoft: 'rgba(244, 67, 54, 0.15)',
  dangerBorder: 'rgba(244, 67, 54, 0.5)',

  warning: '#ff9800',
  warningSoft: 'rgba(255, 152, 0, 0.12)',
  warningBorder: 'rgba(255, 152, 0, 0.35)',

  // Textes
  text: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.72)',
  textMuted: 'rgba(255, 255, 255, 0.45)',
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
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

// Ombre douce réutilisable (iOS) + elevation (Android)
export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  }),
} as const;
