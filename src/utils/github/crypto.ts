import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";

/**
 * Passphrase-based encryption for the GitHub token.
 *
 * The Figma plugin UI iframe is NOT a secure context, so `crypto.subtle`
 * (Web Crypto) is unavailable. We therefore use the audited, pure-JS
 * @noble/hashes + @noble/ciphers (PBKDF2-HMAC-SHA-256 → AES-256-GCM), which
 * work anywhere. AES-GCM is authenticated, so a wrong passphrase fails to
 * decrypt rather than returning garbage. Only the random salt, IV and
 * ciphertext are persisted — never the passphrase or derived key.
 */

export interface EncryptedSecret {
  /** Base64-encoded PBKDF2 salt. */
  salt: string;
  /** Base64-encoded AES-GCM IV (nonce). */
  iv: string;
  /** Base64-encoded ciphertext (includes the GCM auth tag). */
  ciphertext: string;
}

// Pure-JS PBKDF2 is slower than native, so we use a lighter (but still strong)
// iteration count to keep connect/unlock responsive for a local-only secret.
const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, new TextEncoder().encode(passphrase), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  });
}

/** Encrypt `plaintext` with a passphrase (AES-256-GCM). */
export async function encryptSecret(
  plaintext: string,
  passphrase: string,
): Promise<EncryptedSecret> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const ciphertext = gcm(key, iv).encrypt(new TextEncoder().encode(plaintext));
  return {
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

/**
 * Decrypt a {@link EncryptedSecret}. Throws when the passphrase is wrong (the
 * GCM auth tag fails to verify) or the data is corrupt.
 */
export async function decryptSecret(
  secret: EncryptedSecret,
  passphrase: string,
): Promise<string> {
  const key = deriveKey(passphrase, fromBase64(secret.salt));
  try {
    const plaintext = gcm(key, fromBase64(secret.iv)).decrypt(
      fromBase64(secret.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Incorrect passphrase — could not decrypt the saved token.");
  }
}
