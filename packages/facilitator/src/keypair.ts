import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import type { KeyPairSigner } from "@solana/kit";
import { generateKeypair, saveKeypair } from "@agenticpay/sdk";

/**
 * Load a fee-payer keypair. Resolution order:
 *  1. FACILITATOR_KEYPAIR_BYTES env var (JSON-encoded 64-byte array) — for
 *     ephemeral hosts like Heroku/Fly.io where the filesystem is read-only or
 *     wiped on every deploy.
 *  2. JSON file at `path` — for local development.
 *  3. Generate a fresh keypair and persist it at `path` (only if the directory
 *     is writable; Heroku slug fs is read-only at runtime, so this branch is
 *     skipped there and the caller should set FACILITATOR_KEYPAIR_BYTES first).
 */
export async function loadOrCreateFacilitatorSigner(
  path: string
): Promise<KeyPairSigner> {
  const fromEnv = process.env.FACILITATOR_KEYPAIR_BYTES;
  if (fromEnv) {
    const arr = JSON.parse(fromEnv) as number[];
    if (arr.length !== 64) {
      throw new Error(
        `FACILITATOR_KEYPAIR_BYTES must be a 64-byte array, got ${arr.length}`
      );
    }
    return createKeyPairSignerFromBytes(Uint8Array.from(arr));
  }

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
