import { migrate, type Profile } from './profile';

export const SAVE_SECRET = 'cozyGame/v1/ZwieBelSuppe-7f3a91c2';
const MAGIC = 'COZYSAVE';
const VERSION = '1';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function checksum(json: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(`${SAVE_SECRET}|${VERSION}|${json}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function encodeSave(p: Profile): Promise<string> {
  const json = JSON.stringify(p);
  return `${MAGIC}${VERSION}.${toBase64Url(enc.encode(json))}.${await checksum(json)}`;
}

export type DecodeResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: 'format' | 'checksum' | 'version' };

export async function decodeSave(text: string): Promise<DecodeResult> {
  const parts = text.trim().split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };
  const [head, payload, sum] = parts;
  const m = /^COZYSAVE(\d+)$/.exec(head);
  if (!m || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(sum)) {
    return { ok: false, reason: 'format' };
  }
  if (m[1] !== VERSION) return { ok: false, reason: 'version' };
  let json: string;
  try {
    json = dec.decode(fromBase64Url(payload));
  } catch {
    return { ok: false, reason: 'format' };
  }
  if ((await checksum(json)) !== sum) return { ok: false, reason: 'checksum' };
  try {
    return { ok: true, profile: migrate(JSON.parse(json)) };
  } catch {
    return { ok: false, reason: 'format' };
  }
}

export function saveFileName(p: Profile, date: Date): string {
  const name = p.name.replace(/[^A-Za-z0-9_-]/g, '_') || 'Spieler';
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `cozyGame-${name}-${day}.cozysave`;
}
