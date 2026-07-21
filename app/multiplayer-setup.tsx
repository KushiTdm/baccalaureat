// app/multiplayer-setup.tsx - Configuration du mode Bluetooth (BLE)
// Deux rôles distincts :
//   - "Créer une partie" : ce téléphone devient visible (périphérique GATT)
//     et attend qu'un joueur le rejoigne.
//   - "Rejoindre" : scanne les parties à proximité et s'y connecte ; c'est
//     le joueur qui rejoint qui tire la lettre et envoie GAME_START.
import { View, Text, StyleSheet, FlatList, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import Button from '../components/Button';
import { bluetoothService, BluetoothDevice } from '../services/bluetooth';
import { useGameStore } from '../store/gameStore';
import { useUserStore } from '../store/userStore';
import { getCategories } from '../services/api';
import { isDictionaryDownloaded } from '../utils/storage';
import { Bluetooth, Users, Radio, Search, AlertCircle } from 'lucide-react-native';
import { pickRandomLetter } from '../utils/letters';
import { colors, fonts, radius, spacing, shadow } from '../constants/theme';

type Mode = 'choice' | 'hosting' | 'scanning';

export default function MultiplayerSetupScreen() {
  const router = useRouter();
  const { startMultiplayerGame } = useGameStore();
  const { user } = useUserStore();

  const [mode, setMode] = useState<Mode>('choice');
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [hasDict, setHasDict] = useState(true);

  // Ne pas couper la connexion quand on quitte cet écran POUR ALLER au jeu
  const navigatedToGameRef = useRef(false);

  useEffect(() => {
    isDictionaryDownloaded().then(setHasDict);
    return () => {
      if (!navigatedToGameRef.current) {
        bluetoothService.disconnect();
      }
    };
  }, []);

  if (!bluetoothService.isAvailable()) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <Bluetooth size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>Bluetooth non disponible</Text>
          <Text style={styles.emptySubtext}>
            Ce mode nécessite l'application installée sur un téléphone (pas de web ni d'Expo Go).
          </Text>
          <Button title="Retour" onPress={() => router.back()} variant="secondary" />
        </View>
      </View>
    );
  }

  const goToGame = () => {
    navigatedToGameRef.current = true;
    router.replace('/multiplayer-game');
  };

  // Message clair pour les échecs courants au lieu d'un "Erreur" générique
  function bleErrorMessage(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'BLUETOOTH_OFF') {
      return "Le Bluetooth est désactivé sur cet appareil. Activez-le dans les réglages puis réessayez.";
    }
    return message || fallback;
  }

  // ----- RÔLE HÔTE : devenir visible et attendre -----
  async function handleHost() {
    const granted = await bluetoothService.requestPermissions('host');
    if (!granted) {
      Alert.alert('Permissions', 'Les permissions Bluetooth sont nécessaires pour créer une partie.');
      return;
    }

    const canHost = await bluetoothService.supportsHosting();
    if (!canHost) {
      Alert.alert(
        'Non supporté',
        "Cet appareil ne semble pas prendre en charge le mode « point d'accès » Bluetooth requis pour créer une partie. Essayez « Rejoindre une partie » depuis cet appareil à la place (l'autre joueur crée la partie)."
      );
      return;
    }

    try {
      // L'invité qui nous rejoint envoie GAME_START avec lettre + catégories
      bluetoothService.setMessageListener((message) => {
        if (message.type === 'GAME_START') {
          const { letter, categories, opponentName } = message.data;
          startMultiplayerGame(letter, categories, false, opponentName || 'Adversaire');
          goToGame();
        }
      });
      bluetoothService.setConnectionListeners(null, null, (message) => {
        Alert.alert('Bluetooth', message);
      });
      await bluetoothService.startHosting(user?.username || 'Petit Bac');
      setMode('hosting');
    } catch (error) {
      console.error('BLE hosting error:', error);
      Alert.alert('Erreur', bleErrorMessage(error, 'Impossible de créer la partie Bluetooth.'));
    }
  }

  // ----- RÔLE INVITÉ : scanner puis rejoindre -----
  async function handleScan() {
    const granted = await bluetoothService.requestPermissions('guest');
    if (!granted) {
      Alert.alert('Permissions', 'Les permissions Bluetooth sont nécessaires pour scanner.');
      return;
    }

    setMode('scanning');
    setScanning(true);
    setDevices([]);
    bluetoothService.setConnectionListeners(null, null, (message) => {
      Alert.alert('Bluetooth', message);
    });

    try {
      await bluetoothService.scanForDevices((device) => {
        setDevices((prev) =>
          prev.find((d) => d.id === device.id) ? prev : [...prev, device]
        );
      }, 12000);
    } catch (error) {
      console.error('BLE scan error:', error);
      Alert.alert('Erreur', bleErrorMessage(error, 'Impossible de scanner les appareils Bluetooth'));
      setMode('choice');
    } finally {
      setScanning(false);
    }
  }

  async function handleConnectDevice(device: BluetoothDevice) {
    setConnecting(true);

    try {
      await bluetoothService.connectToDevice(device);

      const categories = await getCategories();
      if (categories.length === 0) {
        Alert.alert('Erreur', 'Aucune catégorie disponible');
        await bluetoothService.disconnect();
        return;
      }

      const randomLetter = pickRandomLetter();

      // On envoie tout ce qu'il faut à l'hôte pour démarrer sa manche
      await bluetoothService.sendMessage({
        type: 'GAME_START',
        data: {
          letter: randomLetter,
          categories,
          opponentName: user?.username || 'Adversaire',
        },
      });

      startMultiplayerGame(randomLetter, categories, true, device.name || 'Adversaire');
      goToGame();
    } catch (error) {
      console.error('BLE connect error:', error);
      Alert.alert('Erreur', bleErrorMessage(error, 'Impossible de se connecter à cet appareil'));
      await bluetoothService.disconnect();
    } finally {
      setConnecting(false);
    }
  }

  function handleBack() {
    bluetoothService.disconnect();
    if (mode === 'choice') {
      router.back();
    } else {
      setMode('choice');
      setDevices([]);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Bluetooth size={48} color={colors.primary} />
        <Text style={styles.title}>Mode Bluetooth</Text>
        <Text style={styles.subtitle}>Jouez à deux, sans internet</Text>
      </View>

      {!hasDict && (
        <View style={styles.warningCard}>
          <AlertCircle size={20} color={colors.warning} />
          <Text style={styles.warningText}>
            Sans le dictionnaire hors-ligne (téléchargeable depuis l'accueil), la
            validation des mots nécessitera une connexion internet.
          </Text>
        </View>
      )}

      {/* ----- CHOIX DU RÔLE ----- */}
      {mode === 'choice' && (
        <View style={styles.choiceContainer}>
          <View style={styles.infoCard}>
            <Users size={24} color={colors.primary} />
            <Text style={styles.infoText}>
              Un joueur crée la partie (il devient visible), l'autre la rejoint en scannant.
            </Text>
          </View>

          <Button
            title="Créer une partie"
            onPress={handleHost}
            icon={<Radio size={20} color={colors.onPrimary} />}
          />
          <Button
            title="Rejoindre une partie"
            onPress={handleScan}
            variant="secondary"
            icon={<Search size={20} color={colors.primary} />}
          />
          <Button title="Retour" onPress={handleBack} variant="secondary" />
        </View>
      )}

      {/* ----- HÔTE : EN ATTENTE ----- */}
      {mode === 'hosting' && (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.waitingTitle}>Partie visible</Text>
          <Text style={styles.emptySubtext}>
            En attente d'un joueur à proximité...{'\n'}
            Demandez-lui d'appuyer sur « Rejoindre une partie ».
          </Text>
          <Button title="Annuler" onPress={handleBack} variant="secondary" />
        </View>
      )}

      {/* ----- INVITÉ : SCAN + LISTE ----- */}
      {mode === 'scanning' && (
        <View style={styles.scanContainer}>
          {scanning && (
            <View style={styles.scanningRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.scanningText}>Recherche des parties...</Text>
            </View>
          )}

          {!scanning && devices.length === 0 && (
            <View style={styles.centerContent}>
              <Text style={styles.emptyText}>Aucune partie trouvée</Text>
              <Text style={styles.emptySubtext}>
                Vérifiez que l'autre joueur a bien appuyé sur « Créer une partie »
                et que le Bluetooth est activé.{'\n\n'}
                Sur certains téléphones Android, la LOCALISATION doit aussi être
                activée (Réglages → Position) pour que la recherche Bluetooth
                fonctionne — même si l'app n'en a pas besoin par ailleurs.
              </Text>
            </View>
          )}

          <FlatList
            data={devices}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.deviceCard}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>{item.name || 'Partie Petit Bac'}</Text>
                  <Text style={styles.deviceId}>{item.id}</Text>
                </View>
                <Button
                  title="Rejoindre"
                  onPress={() => handleConnectDevice(item)}
                  disabled={connecting}
                  loading={connecting}
                />
              </View>
            )}
          />

          <View style={styles.buttonContainer}>
            {!scanning && (
              <Button title="Relancer le scan" onPress={handleScan} />
            )}
            <Button title="Retour" onPress={handleBack} variant="secondary" />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.xl,
    paddingTop: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: 32,
    fontFamily: fonts.display,
    color: colors.text,
    marginTop: spacing.lg,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  choiceContainer: {
    gap: spacing.md,
  },
  infoCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  waitingTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  scanContainer: {
    flex: 1,
  },
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  scanningText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  deviceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...shadow.card,
  },
  deviceInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  deviceId: {
    fontSize: 12,
    color: colors.textMuted,
  },
  buttonContainer: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
});
