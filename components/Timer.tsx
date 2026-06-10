// components/Timer.tsx
// Décompte basé sur l'horloge (roundEndsAt du store) et non sur une simple
// décrémentation : le temps reste juste même si le composant re-render à
// chaque frappe, et il suit les resynchronisations serveur (catch-up online).
import { View, Text, StyleSheet } from 'react-native';
import { useEffect, useRef } from 'react';
import { Clock } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useGameStore } from '../store/gameStore';
import { colors, radius, spacing } from '../constants/theme';

type TimerProps = {
  onTimeUp: () => void;
};

export default function Timer({ onTimeUp }: TimerProps) {
  const { timeRemaining, roundDurationSec, isPlaying } = useGameStore();

  // Ref pour ne jamais recréer l'interval quand le parent re-render
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;
  const firedRef = useRef(false);

  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!isPlaying) return;
    firedRef.current = false;

    const tick = () => {
      const state = useGameStore.getState();
      if (!state.isPlaying) return;

      let endsAt = state.roundEndsAt;
      if (endsAt === null) {
        // Compat : un écran a mis isPlaying sans initialiser l'horloge
        endsAt = Date.now() + state.timeRemaining * 1000;
        useGameStore.setState({ roundEndsAt: endsAt });
      }

      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (remaining !== state.timeRemaining) {
        state.setTimeRemaining(remaining);
      }
      if (remaining <= 0 && !firedRef.current) {
        firedRef.current = true;
        onTimeUpRef.current();
      }
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const isUrgent = timeRemaining <= 30;
  const isCritical = timeRemaining <= 10;

  useEffect(() => {
    if (isCritical && isPlaying) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 350 }),
          withTiming(1, { duration: 350 })
        ),
        -1,
        true
      );
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [isCritical, isPlaying, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const progress =
    roundDurationSec > 0 ? Math.min(1, timeRemaining / roundDurationSec) : 0;

  const tint = isCritical ? colors.danger : isUrgent ? colors.warning : colors.primary;

  return (
    <Animated.View
      style={[
        styles.container,
        pulseStyle,
        {
          borderColor: isCritical
            ? colors.dangerBorder
            : isUrgent
              ? colors.warningBorder
              : colors.border,
        },
      ]}
    >
      <View style={styles.timeRow}>
        <Clock size={18} color={tint} />
        <Text style={[styles.time, { color: tint }]}>
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${progress * 100}%`, backgroundColor: tint },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    gap: spacing.sm,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  time: {
    fontSize: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  track: {
    width: '100%',
    minWidth: 96,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.surfaceStrong,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
});
