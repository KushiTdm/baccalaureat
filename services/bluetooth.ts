// services/bluetooth.ts
import { Platform } from 'react-native';

// Types exportés
export type GameMessage = {
  type: 'GAME_START' | 'ANSWER_SUBMIT' | 'GAME_END' | 'SYNC_DATA';
  data: any;
};

export type BluetoothPlayer = {
  id: string;
  name: string;
  device: any;
};

// Import conditionnel de BleManager (uniquement sur mobile)
let BleManager: any = null;
let PermissionsAndroid: any = null;

if (Platform.OS !== 'web') {
  try {
    const bleModule = require('react-native-ble-plx');
    BleManager = bleModule.BleManager;
    
    const rnModule = require('react-native');
    PermissionsAndroid = rnModule.PermissionsAndroid;
  } catch (error) {
    console.warn('Bluetooth module not available');
  }
}

const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const CHARACTERISTIC_UUID = '87654321-4321-4321-4321-cba987654321';

class BluetoothService {
  private manager: any = null;
  private connectedDevice: any = null;
  private onMessageReceived: ((message: GameMessage) => void) | null = null;

  constructor() {
    // Initialiser le manager seulement sur mobile
    if (Platform.OS !== 'web' && BleManager) {
      this.manager = new BleManager();
    }
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'web') {
      return false; // Bluetooth non supporté sur web
    }

    if (!PermissionsAndroid) {
      return false;
    }

    if (Platform.OS === 'android' && Platform.Version >= 31) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);

      return Object.values(granted).every(
        (status) => status === PermissionsAndroid.RESULTS.GRANTED
      );
    } else if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }

    return true;
  }

  async scanForDevices(
    onDeviceFound: (device: any) => void,
    duration: number = 10000
  ): Promise<void> {
    if (Platform.OS === 'web' || !this.manager) {
      throw new Error('Bluetooth non disponible sur cette plateforme');
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Permissions Bluetooth refusées');
    }

    return new Promise((resolve, reject) => {
      const foundDevices = new Set<string>();

      this.manager.startDeviceScan(null, null, (error: any, device: any) => {
        if (error) {
          this.manager.stopDeviceScan();
          reject(error);
          return;
        }

        if (device && device.name && !foundDevices.has(device.id)) {
          foundDevices.add(device.id);
          onDeviceFound(device);
        }
      });

      setTimeout(() => {
        this.manager.stopDeviceScan();
        resolve();
      }, duration);
    });
  }

  async connectToDevice(device: any): Promise<void> {
    if (Platform.OS === 'web' || !this.manager) {
      throw new Error('Bluetooth non disponible sur cette plateforme');
    }

    try {
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      this.connectedDevice = connected;

      this.startMonitoring();
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connectedDevice) {
      await this.connectedDevice.cancelConnection();
      this.connectedDevice = null;
    }
  }

  async sendMessage(message: GameMessage): Promise<void> {
    if (Platform.OS === 'web') {
      throw new Error('Bluetooth non disponible sur web');
    }

    if (!this.connectedDevice) {
      throw new Error('Aucun appareil connecté');
    }

    const jsonString = JSON.stringify(message);
    // Utiliser btoa pour l'encodage base64 (disponible dans l'environnement JS de React Native)
    const base64Data = btoa(jsonString);

    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        CHARACTERISTIC_UUID,
        base64Data
      );
    } catch (error) {
      console.error('Send message error:', error);
      throw error;
    }
  }

  private startMonitoring(): void {
    if (!this.connectedDevice) return;

    this.connectedDevice.monitorCharacteristicForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      (error: any, characteristic: any) => {
        if (error) {
          console.error('Monitor error:', error);
          return;
        }

        if (characteristic?.value) {
          try {
            // Utiliser atob pour le décodage base64
            const jsonString = atob(characteristic.value);
            const message: GameMessage = JSON.parse(jsonString);
            
            if (this.onMessageReceived) {
              this.onMessageReceived(message);
            }
          } catch (error) {
            console.error('Parse message error:', error);
          }
        }
      }
    );
  }

  setMessageListener(callback: (message: GameMessage) => void): void {
    this.onMessageReceived = callback;
  }

  isConnected(): boolean {
    return this.connectedDevice !== null;
  }

  getConnectedDevice(): any {
    return this.connectedDevice;
  }

  destroy(): void {
    if (this.manager) {
      this.manager.destroy();
    }
  }
}

export const bluetoothService = new BluetoothService();