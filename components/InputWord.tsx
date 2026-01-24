import { View, Text, TextInput, StyleSheet } from 'react-native';
import Animated, { FadeInRight, useAnimatedStyle, withSpring, useSharedValue } from 'react-native-reanimated';

type InputWordProps = {
  category: string;
  value: string;
  onChangeText: (text: string) => void;
  letter: string;
  index?: number;
};

export default function InputWord({ category, value, onChangeText, letter, index = 0 }: InputWordProps) {
  const isCorrect = value.trim() !== '' && value.toLowerCase().startsWith(letter.toLowerCase());
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: isCorrect ? '#4caf50' : value.trim() !== '' ? '#f44336' : '#e0e0e0',
  }));

  const handleFocus = () => {
    scale.value = withSpring(1.02);
  };

  const handleBlur = () => {
    scale.value = withSpring(1);
  };

  return (
    <Animated.View 
      entering={FadeInRight.delay(index * 100).duration(400)}
      style={styles.container}
    >
      <Text style={styles.category}>{category}</Text>
      <Animated.View style={[styles.inputContainer, animatedStyle]}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={`Mot commençant par ${letter.toUpperCase()}`}
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {value.trim() !== '' && (
          <View style={[styles.indicator, { backgroundColor: isCorrect ? '#4caf50' : '#f44336' }]} />
        )}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  category: {
    fontSize: 14,
    fontWeight: '700',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: 4,
  },
  inputContainer: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 17,
    color: '#333',
    fontWeight: '500',
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 16,
  }
});
