/**
 * H-21: a backup holds your whole money history, including the bank messages. With a passphrase
 * it is encrypted on the phone (AES-GCM, key from PBKDF2-SHA-256) before it is saved anywhere;
 * without the passphrase the file is unreadable — to anyone, including you.
 */

const ITERATIONS = 250_000;

export interface SealedBackup {
  app: 'hisaab';
  version: 2;
  encrypted: true;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  iv: string;
  data: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function keyFrom(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealBackup(json: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt, ITERATIONS);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json)),
  );
  const sealed: SealedBackup = {
    app: 'hisaab',
    version: 2,
    encrypted: true,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toB64(salt) },
    iv: toB64(iv),
    data: toB64(data),
  };
  return JSON.stringify(sealed);
}

/** Is this file a passphrase-protected backup? */
export function isSealed(text: string): boolean {
  try {
    const b = JSON.parse(text) as Partial<SealedBackup>;
    return b?.app === 'hisaab' && b.encrypted === true;
  } catch {
    return false;
  }
}

export async function openBackup(text: string, passphrase: string): Promise<string> {
  const b = JSON.parse(text) as SealedBackup;
  const key = await keyFrom(passphrase, fromB64(b.kdf.salt), b.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(b.iv) },
      key,
      fromB64(b.data),
    );
    return dec.decode(plain);
  } catch {
    throw new Error('Wrong passphrase — or the file was changed.');
  }
}
