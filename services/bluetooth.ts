// services/bluetooth.ts - Multijoueur local en vrai BLE (munim-bluetooth)
//
// Architecture GATT :
//   - L'HÔTE (celui qui "crée la partie") est le PÉRIPHÉRIQUE : il annonce
//     SERVICE_UUID et expose 2 characteristics :
//       INBOX  (write)  : messages invité → hôte
//       OUTBOX (notify) : messages hôte → invité
//   - L'INVITÉ (celui qui "rejoint") est le CENTRAL : il scanne SERVICE_UUID,
//     se connecte, s'abonne à OUTBOX et écrit sur INBOX.
//
// NB rôles de jeu : dans les écrans multiplayer-*, le joueur qui REJOINT
// envoie GAME_START et joue le rôle "hôte de partie" (il tire la lettre).
// C'est indépendant des rôles GATT ci-dessus.
//
// Les messages JSON dépassent le MTU BLE (~185 octets par défaut) : ils sont
// découpés en chunks hex avec un en-tête [msgId, totalChunks, chunkIndex]
// (3 octets) et réassemblés à la réception.
import { Platform } from 'react-native';

// Types exportés (API conservée pour les écrans multiplayer-*)
export type GameMessage = {
  type: 'GAME_START' | 'STOP_GAME' | 'ANSWER_SUBMIT' | 'GAME_END' | 'SYNC_DATA' | 'FINISH_GAME' | 'NEXT_ROUND';
  data: any;
};

export type BluetoothPlayer = {
  id: string;
  name: string;
  device: any;
};

// Appareil découvert lors du scan (remplace le type Device de ble-plx)
export type BluetoothDevice = {
  id: string;
  name: string | null;
};

// Import conditionnel (module natif absent sur web / Expo Go)
let BT: any = null;
if (Platform.OS !== 'web') {
  try {
    BT = require('munim-bluetooth');
  } catch (error) {
    console.warn('Bluetooth module not available');
  }
}

const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const INBOX_UUID = '87654321-4321-4321-4321-cba987654321'; // invité → hôte (write)
const OUTBOX_UUID = '87654321-4321-4321-4321-cba987654322'; // hôte → invité (notify)

// Taille de payload par chunk (octets). 150 passe sous le MTU minimum ATT
// même sans négociation ; on tente quand même requestMTU(512) côté central.
const CHUNK_PAYLOAD_SIZE = 150;

// ---------- Encodage hex <-> UTF-8 ----------

function utf8ToHex(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function hexToUtf8(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

type Role = 'idle' | 'host' | 'guest';

class BluetoothService {
  private role: Role = 'idle';
  private connected = false;
  private peerDeviceId: string | null = null; // côté central : id du périphérique

  private onMessageReceived: ((message: GameMessage) => void) | null = null;
  private onPeerConnected: ((name: string) => void) | null = null;
  private onPeerDisconnected: (() => void) | null = null;

  // Réassemblage des chunks : msgId -> chunks reçus
  private rxBuffers = new Map<number, { total: number; parts: Map<number, string> }>();
  private txMsgId = 0;

  // Unsubscribe handlers des addEventListener actifs
  private listeners: Array<() => void> = [];
  private scanStopTimer: ReturnType<typeof setTimeout> | null = null;

  isAvailable(): boolean {
    return BT !== null;
  }

  // ---------- Permissions ----------

  async requestPermissions(role: 'host' | 'guest'): Promise<boolean> {
    if (!BT) return false;
    try {
      const caps = role === 'host' ? ['advertise', 'connect'] : ['scan', 'connect'];
      return await BT.requestBluetoothPermission(caps);
    } catch (error) {
      console.warn('BLE permissions refusées:', error);
      return false;
    }
  }

  // ---------- Réception (commun) ----------

  private handleIncomingChunk(hexValue: string): void {
    try {
      const clean = hexValue.replace(/[^0-9a-fA-F]/g, '');
      if (clean.length < 6) return;
      const msgId = parseInt(clean.substr(0, 2), 16);
      const total = parseInt(clean.substr(2, 2), 16);
      const index = parseInt(clean.substr(4, 2), 16);
      const payload = clean.substr(6);

      let buf = this.rxBuffers.get(msgId);
      if (!buf || buf.total !== total) {
        buf = { total, parts: new Map() };
        this.rxBuffers.set(msgId, buf);
      }
      buf.parts.set(index, payload);

      if (buf.parts.size === total) {
        this.rxBuffers.delete(msgId);
        let fullHex = '';
        for (let i = 0; i < total; i++) fullHex += buf.parts.get(i) || '';
        const json = hexToUtf8(fullHex);
        const message: GameMessage = JSON.parse(json);
        this.onMessageReceived?.(message);
      }
    } catch (error) {
      console.error('BLE: chunk illisible', error);
    }
  }

  // ---------- Rôle HÔTE (périphérique GATT) ----------

  /**
   * Devient visible : publie le service GATT et annonce SERVICE_UUID.
   * `onPeerConnected` est déclenché quand un invité s'abonne à OUTBOX.
   */
  async startHosting(localName: string): Promise<void> {
    if (!BT) throw new Error('Bluetooth non disponible');
    this.cleanupListeners();
    this.role = 'host';
    this.connected = false;

    BT.setServices([
      {
        uuid: SERVICE_UUID,
        characteristics: [
          { uuid: INBOX_UUID, properties: ['write', 'writeWithoutResponse'] },
          { uuid: OUTBOX_UUID, properties: ['read', 'notify'] },
        ],
      },
    ]);

    // Messages de l'invité (écritures sur INBOX)
    this.listeners.push(
      BT.addEventListener('peripheralWriteRequest', (data: any) => {
        if (data?.characteristicUUID?.toLowerCase() === INBOX_UUID.toLowerCase()) {
          this.handleIncomingChunk(data.value || '');
        }
      })
    );

    // L'invité s'est abonné à OUTBOX → canal bidirectionnel prêt
    this.listeners.push(
      BT.addEventListener('peripheralSubscribed', () => {
        this.connected = true;
        this.onPeerConnected?.('Adversaire');
      })
    );
    this.listeners.push(
      BT.addEventListener('peripheralUnsubscribed', () => {
        this.connected = false;
        this.onPeerDisconnected?.();
      })
    );

    BT.startAdvertising({
      serviceUUIDs: [SERVICE_UUID],
      localName: localName.slice(0, 20) || 'Petit Bac',
    });
  }

  stopHosting(): void {
    if (!BT) return;
    try {
      BT.stopAdvertising();
    } catch {}
  }

  // ---------- Rôle INVITÉ (central) ----------

  /**
   * Scanne les hôtes Petit Bac à proximité (filtré sur SERVICE_UUID).
   */
  async scanForDevices(
    onDeviceFound: (device: BluetoothDevice) => void,
    duration: number = 10000
  ): Promise<void> {
    if (!BT) throw new Error('Bluetooth non disponible');
    this.cleanupListeners();
    this.role = 'guest';

    const seen = new Set<string>();
    this.listeners.push(
      BT.addEventListener('deviceFound', (device: any) => {
        if (!device?.id || seen.has(device.id)) return;
        seen.add(device.id);
        onDeviceFound({
          id: device.id,
          name: device.localName || device.name || null,
        });
      })
    );

    BT.startScan({ serviceUUIDs: [SERVICE_UUID] });

    return new Promise((resolve) => {
      if (this.scanStopTimer) clearTimeout(this.scanStopTimer);
      this.scanStopTimer = setTimeout(() => {
        this.stopScan();
        resolve();
      }, duration);
    });
  }

  stopScan(): void {
    if (!BT) return;
    try {
      BT.stopScan();
    } catch {}
  }

  /**
   * Connexion à un hôte : MTU élargi, découverte GATT, abonnement à OUTBOX.
   */
  async connectToDevice(device: BluetoothDevice): Promise<void> {
    if (!BT) throw new Error('Bluetooth non disponible');
    this.stopScan();
    this.role = 'guest';

    await BT.connect(device.id);
    this.peerDeviceId = device.id;

    try {
      await BT.requestMTU(device.id, 512);
    } catch {
      // MTU par défaut : le chunking gère
    }

    await BT.discoverServices(device.id);

    // Notifications de l'hôte (OUTBOX)
    this.listeners.push(
      BT.addEventListener('characteristicValueChanged', (data: any) => {
        if (
          data?.deviceId === this.peerDeviceId &&
          data?.characteristicUUID?.toLowerCase() === OUTBOX_UUID.toLowerCase()
        ) {
          this.handleIncomingChunk(data.value || '');
        }
      })
    );
    this.listeners.push(
      BT.addEventListener('deviceDisconnected', (data: any) => {
        if (data?.deviceId === this.peerDeviceId) {
          this.connected = false;
          this.onPeerDisconnected?.();
        }
      })
    );

    BT.subscribeToCharacteristic(device.id, SERVICE_UUID, OUTBOX_UUID);
    this.connected = true;
  }

  // ---------- Envoi (commun) ----------

  async sendMessage(message: GameMessage): Promise<void> {
    if (!BT || this.role === 'idle') {
      throw new Error('Bluetooth non connecté');
    }

    const hex = utf8ToHex(JSON.stringify(message));
    const msgId = this.txMsgId = (this.txMsgId + 1) % 256;
    const payloadHexLen = CHUNK_PAYLOAD_SIZE * 2;
    const total = Math.max(1, Math.ceil(hex.length / payloadHexLen));

    for (let i = 0; i < total; i++) {
      const header =
        msgId.toString(16).padStart(2, '0') +
        total.toString(16).padStart(2, '0') +
        i.toString(16).padStart(2, '0');
      const chunk = header + hex.substr(i * payloadHexLen, payloadHexLen);

      if (this.role === 'host') {
        await BT.updateCharacteristicValue(SERVICE_UUID, OUTBOX_UUID, chunk, true);
      } else {
        if (!this.peerDeviceId) throw new Error('Aucun appareil connecté');
        await BT.writeCharacteristic(this.peerDeviceId, SERVICE_UUID, INBOX_UUID, chunk, 'write');
      }
    }
  }

  // ---------- Listeners applicatifs ----------

  setMessageListener(callback: ((message: GameMessage) => void) | null): void {
    this.onMessageReceived = callback;
  }

  setConnectionListeners(
    onConnected: ((name: string) => void) | null,
    onDisconnected: (() => void) | null
  ): void {
    this.onPeerConnected = onConnected;
    this.onPeerDisconnected = onDisconnected;
  }

  // ---------- État / nettoyage ----------

  isConnected(): boolean {
    return this.connected;
  }

  private cleanupListeners(): void {
    for (const unsub of this.listeners) {
      try {
        unsub();
      } catch {}
    }
    this.listeners = [];
    if (this.scanStopTimer) {
      clearTimeout(this.scanStopTimer);
      this.scanStopTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    if (!BT) return;
    try {
      this.stopScan();
      if (this.role === 'host') {
        this.stopHosting();
      }
      if (this.peerDeviceId) {
        BT.disconnect(this.peerDeviceId);
      }
    } catch (error) {
      console.warn('BLE disconnect:', error);
    } finally {
      this.role = 'idle';
      this.connected = false;
      this.peerDeviceId = null;
      this.rxBuffers.clear();
      this.cleanupListeners();
      this.onMessageReceived = null;
      this.onPeerConnected = null;
      this.onPeerDisconnected = null;
    }
  }
}

export const bluetoothService = new BluetoothService();
