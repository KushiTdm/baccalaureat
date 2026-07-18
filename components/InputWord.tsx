import { Text, TextInput, StyleSheet } from 'react-native';
import { forwardRef } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react-native';
import Animated, { FadeInRight, useAnimatedStyle, withSpring, useSharedValue } from 'react-native-reanimated';
import { colors, radius, spacing, shadow } from '../constants/theme';
import { startsWithLetter } from '../utils/normalize';

type InputWordProps = {
  category: string;
  value: string;
  onChangeText: (text: string) => void;
  letter: string;
  index?: number;
  editable?: boolean;
  // Navigation clavier : « Suivant » passe au champ d'après, « OK » sur le dernier
  isLast?: boolean;
  onSubmitNext?: () => void;
};

const InputWord = forwardRef<TextInput, InputWordProps>(function InputWord(
  { category, value, onChangeText, letter, index = 0, editable = true, isLast = false, onSubmitNext },
  ref
) {
  const hasValue = value.trim() !== '';
  const isCorrect = hasValue && startsWithLetter(value, letter);
  const scale = useSharedValue(1);
  const focused = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: isCorrect
      ? colors.successSoft
      : hasValue
        ? colors.dangerBorder
        : focused.value
          ? colors.primary
          : 'transparent',
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
      <Animated.View style={[styles.inputContainer, animatedStyle, !editable && styles.inputDisabled]}>
        <Text style={styles.category} numberOfLines={1}>{category}</Text>
        <TextInput
          ref={ref}
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
          returnKeyType={isLast ? 'done' : 'next'}
          blurOnSubmit={isLast}
          onSubmitEditing={onSubmitNext}
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
});

export default InputWord;

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  // Libellé de catégorie intégré à gauche de la ligne (design "Variante A")
  category: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    width: 82,
    marginLeft: spacing.lg,
  },
  inputContainer: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadow.card,
  },
  inputDisabled: {
    opacity: 0.55,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    fontSize: 17,
    color: colors.text,
    fontWeight: '600',
  },
  indicator: {
    marginRight: spacing.lg,
  },
});
