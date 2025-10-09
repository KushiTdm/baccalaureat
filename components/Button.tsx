import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
};

export default function Button({ title, onPress, variant = 'primary', disabled = false, loading = false }: ButtonProps) {
  return (
    <TouchableOpacity
      style={[
        styles.button,
        variant === 'primary' ? styles.primary : styles.secondary,
        (disabled || loading) && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : '#007AFF'} />
      ) : (
        <Text style={[styles.text, variant === 'secondary' && styles.secondaryText]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primary: {
    backgroundColor: '#007AFF',
  },
  secondary: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryText: {
    color: '#007AFF',
  },
});
