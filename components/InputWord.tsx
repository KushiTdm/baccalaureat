import { Text, TextInput, StyleSheet } from 'react-native';
import { CheckCircle2, XCircle } from 'lucide-react-native';
import Animated, { FadeInRight, useAnimatedStyle, withSpring, useSharedValue } from 'react-native-reanimated';
import { colors, radius, spacing } from '../constants/theme';

type InputWordProps = {
  category: string;
  value: string;
  onChangeText: (text: string) => void;
  letter: string;
  index?: number;
  editable?: boolean;
};

export default function InputWord({ category, value, onChangeText, letter, index = 0, editable = true }: InputWordProps) {
  const hasValue = value.trim() !== '';
  const isCorrect = hasValue && value.toLowerCase().startsWith(letter.toLowerCase());
  const scale = useSharedValue(1);
  const focused = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: isCorrect
      ? colors.successBorder
      : hasValue
        ? colors.dangerBorder
        : focused.value
          ? colors.primaryBorder
          : colors.border,
  }));

  const handleFocus = () => {
    scale.value = withSpring(1.02);
    focused.value = 1;
  };

  const handleBlur = () => {
    scale.value = withSpring(1);
    focused.value = 0;
  };

  return (
    <Animated.View
      entering={FadeInRight.delay(index * 80).duration(350)}
      style={styles.container}
    >
      <Text style={styles.category}>{category}</Text>
      <Animated.View style={[styles.inputContainer, animatedStyle, !editable && styles.inputDisabled]}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          editable={editable}
          placeholder={`Mot commençant par ${letter.toUpperCase()}`}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          blurOnSubmit={false}
        />
        {hasValue && (
          isCorrect ? (
            <CheckCircle2 size={20} color={colors.success} style={styles.indicator} />
          ) : (
            <XCircle size={20} color={colors.danger} style={styles.indicator} />
          )
        )}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  category: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: spacing.xs,
  },
  inputContainer: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputDisabled: {
    opacity: 0.55,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    fontSize: 17,
    color: colors.text,
    fontWeight: '500',
  },
  indicator: {
    marginRight: spacing.lg,
  },
});
