// services/bluetooth.ts
import { BleManager, Device, Characteristic } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';

const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const CHARACTERISTIC_UUID = '87654321-4321-4321-4321-cba987654321';

export type GameMessage = {
  type: 'GAME_START' | 'ANSWER_SUBMIT' | 'GAME_END' | 'SYNC_DATA';
  data: any;
};

export type BluetoothPlayer = {
  id: string;
  name: string;
  device: Device;
};

class BluetoothService {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private onMessageReceived: ((message: GameMessage) => void) | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  async requestPermissions(): Promise<boolean> {
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
    onDeviceFound: (device: Device) => void,
    duration: number = 10000
  ): Promise<void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Bluetooth permissions not granted');
    }

    return new Promise((resolve, reject) => {
      const foundDevices = new Set<string>();

      this.manager.startDeviceScan(null, null, (error, device) => {
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

  async connectToDevice(device: Device): Promise<void> {
    try {
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      this.connectedDevice = connected;

      // Start monitoring for messages
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
    if (!this.connectedDevice) {
      throw new Error('No device connected');
    }

    const jsonString = JSON.stringify(message);
    const base64Data = Buffer.from(jsonString).toString('base64');

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
      (error, characteristic) => {
        if (error) {
          console.error('Monitor error:', error);
          return;
        }

        if (characteristic?.value) {
          try {
            const jsonString = Buffer.from(characteristic.value, 'base64').toString();
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

  getConnectedDevice(): Device | null {
    return this.connectedDevice;
  }

  destroy(): void {
    this.manager.destroy();
  }
}

export const bluetoothService = new BluetoothService();