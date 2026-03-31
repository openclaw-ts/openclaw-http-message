import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { DeviceIdentity } from '../types/index.js';

const DEVICE_ID_FILE = path.join(
  os.homedir(),
  '.openclaw',
  '.device-identity.json',
);

function bufToBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateKeyPair(): Promise<{
  publicKey: crypto.KeyObject;
  privateKey: crypto.KeyObject;
}> {
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair(
      'ed25519',
      {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      },
      (err, publicKey, privateKey) => {
        if (err) reject(err);
        else {
          const pubKeyObj = crypto.createPublicKey(publicKey);
          const privKeyObj = crypto.createPrivateKey(privateKey);
          resolve({ publicKey: pubKeyObj, privateKey: privKeyObj });
        }
      },
    );
  });
}

function extractPublicKeyRaw(publicKey: crypto.KeyObject): Buffer {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return spki.subarray(-32);
}

function fingerprintKey(publicKey: crypto.KeyObject): string {
  const raw = extractPublicKeyRaw(publicKey);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

interface StoredIdentity {
  version: 1;
  deviceId: string;
  publicKeyRaw: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  if (fs.existsSync(DEVICE_ID_FILE)) {
    try {
      const rawContent = fs.readFileSync(DEVICE_ID_FILE, 'utf-8');
      const stored: StoredIdentity = JSON.parse(rawContent) as StoredIdentity;
      if (stored.version === 1) {
        const privateKey = crypto.createPrivateKey(stored.privateKeyPem);
        const publicKey = crypto.createPublicKey(stored.publicKeyPem);
        return {
          id: stored.deviceId,
          publicKeyRaw: stored.publicKeyRaw,
          privateKey: privateKey.export({ format: 'jwk' }),
          publicKey: publicKey.export({ format: 'jwk' }),
        };
      }
    } catch {
      // Corrupted, regenerate below
    }
  }

  const keyPair = await generateKeyPair();
  const publicKeyRaw = extractPublicKeyRaw(keyPair.publicKey);
  const deviceId = fingerprintKey(keyPair.publicKey);

  const publicKeyPem = keyPair.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const privateKeyPem = keyPair.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();

  const stored: StoredIdentity = {
    version: 1,
    deviceId,
    publicKeyRaw: bufToBase64Url(publicKeyRaw),
    publicKeyPem,
    privateKeyPem,
  };

  fs.writeFileSync(DEVICE_ID_FILE, JSON.stringify(stored, null, 2));

  return {
    id: deviceId,
    publicKeyRaw: stored.publicKeyRaw,
    privateKey: keyPair.privateKey.export({ format: 'jwk' }),
    publicKey: keyPair.publicKey.export({ format: 'jwk' }),
  };
}

export function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce?: string | null;
}): string {
  const version = params.nonce ? 'v2' : 'v1';
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
  ];
  if (version === 'v2') base.push(params.nonce ?? '');
  return base.join('|');
}

export function signPayload(
  privateKey: crypto.KeyObject,
  payload: string,
): string {
  const signature = crypto.sign(null, Buffer.from(payload), privateKey);
  return bufToBase64Url(signature);
}
