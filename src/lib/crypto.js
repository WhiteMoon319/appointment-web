/**
 * 密码哈希工具：PBKDF2 + SHA-256，10 万次迭代
 */

async function pbkdf2(password, salt, iterations = 100000, keyLen = 32) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial, keyLen * 8
  );
  return new Uint8Array(bits);
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createPasswordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, toHex(salt));
  return { salt: toHex(salt), hash: toHex(hash) };
}

export async function verifyPassword(password, salt, expectedHash) {
  const hash = await pbkdf2(password, salt);
  return toHex(hash) === expectedHash;
}

export function randomToken() {
  const buf = crypto.getRandomValues(new Uint8Array(24));
  return toHex(buf);
}