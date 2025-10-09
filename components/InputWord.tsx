import { View, Text, TextInput, StyleSheet } from 'react-native';

type InputWordProps = {
  category: string;
  value: string;
  onChangeText: (text: string) => void;
  letter: string;
};

export default function InputWord({ category, value, onChangeText, letter }: InputWordProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.category}>{category}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={`Mot commençant par ${letter.toUpperCase()}`}
        placeholderTextColor="#999"
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  category: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#333',
  },
});
