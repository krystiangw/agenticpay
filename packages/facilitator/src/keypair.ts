import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import type { KeyPairSigner } from "@solana/kit";
import { generateKeypair, saveKeypair } from "@agentpay/sdk";

/**
 * Load a fee-payer keypair from a JSON file (the standard solana-keygen format:
 * a 64-byte array). If the file does not exist, generate a new one using
 * `@solana/web3.js`'s extractable Keypair (so we can persist the bytes), save
 * it, and then return a `@solana/kit` KeyPairSigner usable by @x402/svm.
 */
export async function loadOrCreateFacilitatorSigner(
  path: string
): Promise<KeyPairSigner> {
  let bytes: Uint8Array;

  if (existsSync(path)) {
    const arr = JSON.parse(readFileSync(path, "utf-8")) as number[];
    if (arr.length !== 64) {
      throw new Error(
        `Invalid keypair at ${path}: expected 64 bytes, got ${arr.length}`
      );
    }
    bytes = Uint8Array.from(arr);
  } else {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const fresh = generateKeypair();
    saveKeypair(fresh, path);
    bytes = fresh.secretKey;
  }

  return createKeyPairSignerFromBytes(bytes);
}
