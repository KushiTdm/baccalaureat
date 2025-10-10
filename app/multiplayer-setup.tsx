// app/multiplayer-setup.tsx
import { View, Text, StyleSheet, FlatList, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { Device } from 'react-native-ble-plx';
import Button from '../components/Button';
import { bluetoothService } from '../services/bluetooth';
import { useGameStore } from '../store/gameStore';
import { getCategories } from '../services/api';
import { Bluetooth, Users } from 'lucide-react-native';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default function MultiplayerSetupScreen() {
  const router = useRouter();
  const { startMultiplayerGame } = useGameStore();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    return () => {
      if (bluetoothService.isConnected()) {
        bluetoothService.disconnect();
      }
    };
  }, []);

  async function handleScanDevices() {
    setScanning(true);
    setDevices([]);

    try {
      await bluetoothService.scanForDevices(
        (device) => {
          setDevices((prev) => {
            if (!prev.find((d) => d.id === device.id)) {
              return [...prev, device];
            }
            return prev;
          });
        },
        10000
      );
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de scanner les appareils Bluetooth');
    } finally {
      setScanning(false);
    }
  }

  async function handleConnectDevice(device: Device) {
    setConnecting(true);

    try {
      await bluetoothService.connectToDevice(device);
      
      // Load categories
      const categories = await getCategories();
      if (categories.length === 0) {
        Alert.alert('Erreur', 'Aucune catégorie disponible');
        await bluetoothService.disconnect();
        return;
      }

      // Choose random letter
      const randomLetter = LETTERS[Math.floor(Math.random() * LETTERS.length)];

      // Send game start message to opponent
      await bluetoothService.sendMessage({
        type: 'GAME_START',
        data: {
          letter: randomLetter,
          categories: categories,
          isHost: false,
        },
      });

      // Start game for host
      startMultiplayerGame(randomLetter, categories, true, device.name || 'Adversaire');

      Alert.alert(
        'Connecté !',
        `Vous êtes connecté à ${device.name}. La partie va commencer.`,
        [
          {
            text: 'OK',
            onPress: () => router.push('/multiplayer-game'),
          },
        ]
      );
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de se connecter à cet appareil');
      await bluetoothService.disconnect();
    } finally {
      setConnecting(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Bluetooth size={48} color="#007AFF" />
        <Text style={styles.title}>Mode Multijoueur</Text>
        <Text style={styles.subtitle}>Connectez-vous via Bluetooth</Text>
      </View>

      <View style={styles.infoCard}>
        <Users size={24} color="#007AFF" />
        <Text style={styles.infoText}>
          Scannez les appareils à proximité et connectez-vous pour jouer ensemble
        </Text>
      </View>

      {scanning && (
        <View style={styles.scanningContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.scanningText}>Recherche en cours...</Text>
        </View>
      )}

      {!scanning && devices.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Aucun appareil trouvé</Text>
          <Text style={styles.emptySubtext}>
            Assurez-vous que le Bluetooth est activé sur les deux appareils
          </Text>
        </View>
      )}

      {devices.length > 0 && (
        <View style={styles.devicesContainer}>
          <Text style={styles.devicesTitle}>Appareils disponibles</Text>
          <FlatList
            data={devices}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.deviceCard}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>{item.name || 'Appareil inconnu'}</Text>
                  <Text style={styles.deviceId}>{item.id}</Text>
                </View>
                <Button
                  title="Connecter"
                  onPress={() => handleConnectDevice(item)}
                  disabled={connecting}
                />
              </View>
            )}
          />
        </View>
      )}

      <View style={styles.buttonContainer}>
        <Button
          title={scanning ? 'Arrêter le scan' : 'Scanner les appareils'}
          onPress={scanning ? () => setScanning(false) : handleScanDevices}
          loading={scanning}
        />
        <Button
          title="Retour"
          onPress={() => router.back()}
          variant="secondary"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
    paddingTop: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#333',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  infoCard: {
    backgroundColor: '#e3f2fd',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#1976d2',
    lineHeight: 20,
  },
  scanningContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  scanningText: {
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  devicesContainer: {
    flex: 1,
    marginBottom: 16,
  },
  devicesTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  deviceCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  deviceInfo: {
    flex: 1,
    marginRight: 12,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  deviceId: {
    fontSize: 12,
    color: '#999',
  },
  buttonContainer: {
    gap: 12,
  },
});