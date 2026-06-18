import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "./crypto";

describe("crypto", () => {
  it("round-trips a secret with the correct passphrase", async () => {
    const secret = await encryptSecret("ghp_secret_token", "correct horse battery staple");
    // Ciphertext must not leak the plaintext.
    expect(secret.ciphertext).not.toContain("ghp_secret_token");
    expect(secret.salt).toBeTruthy();
    expect(secret.iv).toBeTruthy();

    const decrypted = await decryptSecret(secret, "correct horse battery staple");
    expect(decrypted).toBe("ghp_secret_token");
  });

  it("throws on the wrong passphrase", async () => {
    const secret = await encryptSecret("ghp_secret_token", "right-passphrase");
    await expect(decryptSecret(secret, "wrong-passphrase")).rejects.toThrow(/passphrase/i);
  });

  it("uses a fresh salt and IV for each encryption", async () => {
    const a = await encryptSecret("x", "p");
    const b = await encryptSecret("x", "p");
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
