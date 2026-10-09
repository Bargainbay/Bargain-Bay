// Encrypting the few secrets this app must be able to read back (a vendor's bank
// account number, to build a payout file). AES-256-GCM, with the owner of the secret
// bound in as additional authenticated data: a ciphertext copied onto another vendor's
// row will not decrypt, so an attacker with write access to the table cannot redirect
// one vendor's payout to another's account by swapping blobs.
//
// FAILS CLOSED. With no key configured, nothing is stored — the alternative is writing
// bank details in the clear because somebody forgot an environment variable.
//
// Key: BANK_ENCRYPTION_KEY = 32 random bytes, base64 (openssl rand -base64 32). Rotating
// it means re-encrypting every row, so the stored form is versioned ("v1:").
import crypto from 'node:crypto';

function key() {
  const raw = process.env.BANK_ENCRYPTION_KEY;
  if (!raw) throw new Error('Bank details cannot be stored: BANK_ENCRYPTION_KEY is not set.');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('BANK_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  return k;
}

export function encryptSecret(plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(token, aad) {
  const [v, iv, tag, ct] = String(token || '').split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unreadable secret.');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(String(aad)));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  try {
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new Error('Could not decrypt that secret (wrong key, or it was moved to another record).');
  }
}

export const secretsConfigured = () => {
  try { key(); return true; } catch { return false; }
};
