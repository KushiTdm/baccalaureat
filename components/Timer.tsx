//components/Timer.tsx
import { View, Text, StyleSheet } from 'react-native';
import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

type TimerProps = {
  onTimeUp: () => void;
};

export default function Timer({ onTimeUp }: TimerProps) {
  const { timeRemaining, setTimeRemaining, isPlaying } = useGameStore();

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setTimeRemaining(timeRemaining - 1);

      if (timeRemaining <= 1) {
        clearInterval(interval);
        onTimeUp();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [timeRemaining, isPlaying, onTimeUp, setTimeRemaining]);

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;

  const isUrgent = timeRemaining <= 30;

  return (
    <View style={[styles.container, isUrgent && styles.urgent]}>
      <Text style={[styles.time, isUrgent && styles.urgentText]}>
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  urgent: {
    backgroundColor: '#ffebee',
  },
  time: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
  },
  urgentText: {
    color: '#d32f2f',
  },
});
