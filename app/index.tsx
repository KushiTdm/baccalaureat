// app/index.tsx
import { View, Text, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import Button from '../components/Button';
import { getCategories, downloadDictionary, isOnline } from '../services/api';
import { isDictionaryDownloaded } from '../utils/storage';
import { initOfflineDatabase, loadOfflineDictionary } from '../services/offline';
import { useGameStore } from '../store/gameStore';
import { Download, Wifi, WifiOff, Users, Globe, Bluetooth } from 'lucide-react-native';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function HomeScreen() {
  const router = useRouter();
  const { startGame } = useGameStore();
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [hasOfflineDict, setHasOfflineDict] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    const downloaded = await isDictionaryDownloaded();
    setHasOfflineDict(downloaded);

    const networkStatus = await isOnline();
    setOnline(networkStatus);

    if (downloaded) {
      await initOfflineDatabase();
      await loadOfflineDictionary();
    }
  }

  async function handleStartGame() {
    setLoading(true);
    try {
      const categories = await getCategories();
      if (categories.length === 0) {
        Alert.alert('Erreur', 'Aucune catégorie disponible');
        return;
      }

      const randomLetter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      startGame(randomLetter, categories);
      router.push('/game');
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de charger les catégories');
    } finally {
      setLoading(false);
    }
  }

  async function handleStartMultiplayer() {
    router.push('/multiplayer-setup');
  }

  async function handleStartOnline() {
    if (!online) {
      Alert.alert('Hors ligne', 'Vous devez être connecté pour jouer en ligne');
      return;
    }
    router.push('/online-setup');
  }

  async function handleDownloadDictionary() {
  if (!online) {
    Alert.alert('Hors ligne', 'Vous devez être connecté pour télécharger le dictionnaire');
    return;
  }

  setDownloading(true);
  try {
    await downloadDictionary();
    await initOfflineDatabase();
    await loadOfflineDictionary();
    setHasOfflineDict(true);
    Alert.alert('Succès', 'Le dictionnaire a été téléchargé avec succès');
  } catch (error: any) {
    console.error('Download error:', error);
    // Afficher le vrai message d'erreur
    Alert.alert(
      'Erreur', 
      error.message || 'Impossible de télécharger le dictionnaire'
    );
  } finally {
    setDownloading(false);
  }
}

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Petit Bac</Text>
          <Text style={styles.subtitle}>Jeu de Baccalauréat</Text>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            {online ? (
              <Wifi size={24} color="#4caf50" />
            ) : (
              <WifiOff size={24} color="#f44336" />
            )}
            <Text style={styles.statusText}>
              {online ? 'En ligne' : 'Hors ligne'}
            </Text>
          </View>

          {hasOfflineDict && (
            <View style={[styles.statusRow, { marginTop: 8 }]}>
              <Download size={24} color="#2196f3" />
              <Text style={styles.statusText}>Dictionnaire téléchargé</Text>
            </View>
          )}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Comment jouer ?</Text>
          <Text style={styles.infoText}>
            1. Une lettre aléatoire sera choisie{'\n'}
            2. Trouvez un mot commençant par cette lettre pour chaque catégorie{'\n'}
            3. Vous avez 2 minutes pour remplir toutes les catégories{'\n'}
            4. Chaque mot valide rapporte 10 points
          </Text>
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Jouer solo"
            onPress={handleStartGame}
            loading={loading}
          />

          <View style={styles.multiplayerSection}>
            <Text style={styles.sectionTitle}>Modes multijoueur</Text>
            
            <Button
              title="Jeu en ligne"
              onPress={handleStartOnline}
              variant="secondary"
              icon={<Globe size={20} color="#007AFF" />}
              disabled={!online}
            />

            <Button
              title="Bluetooth (local)"
              onPress={handleStartMultiplayer}
              variant="secondary"
              icon={<Bluetooth size={20} color="#007AFF" />}
            />
          </View>

          <Button
            title={hasOfflineDict ? 'Mettre à jour le dictionnaire' : 'Télécharger le dictionnaire'}
            onPress={handleDownloadDictionary}
            variant="secondary"
            loading={downloading}
            disabled={!online}
          />
        </View>

        {!hasOfflineDict && (
          <Text style={styles.warningText}>
            Téléchargez le dictionnaire pour jouer hors ligne
          </Text>
        )}

        {!online && (
          <Text style={styles.warningText}>
            Le mode en ligne nécessite une connexion internet
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 42,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
   infoTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 15,
    color: '#666',
    lineHeight: 24,
  },
  buttonContainer: {
    gap: 16,
  },
  warningText: {
    marginTop: 16,
    textAlign: 'center',
    fontSize: 14,
    color: '#ff9800',
    fontWeight: '500',
  },
  multiplayerSection: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 8,
    marginBottom: 4,
  },
});