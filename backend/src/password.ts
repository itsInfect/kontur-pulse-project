import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { verify as verifyArgon2 } from 'argon2';

const scryptOptions = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const keyLength = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, scryptOptions, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt:v1:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  if (stored.startsWith('$argon2')) return verifyArgon2(stored, password);
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== 'v1') return false;
  if (!/^[A-Za-z0-9_-]{22}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[3])) return false;
  const salt = Buffer.from(parts[2], 'base64url');
  const expected = Buffer.from(parts[3], 'base64url');
  if (salt.length !== 16 || expected.length !== keyLength) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
