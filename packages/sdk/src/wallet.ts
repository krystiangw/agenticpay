import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Load a Solana keypair from one of the standard formats.
 * Supports:
 *  - JSON file produced by `solana-keygen new` (array of bytes, length 64)
 *  - base58-encoded secret key string (e.g. exported from Phantom)
 */
export function loadKeypair(source: string): Keypair {
  if (source.endsWith(".json")) {
    const raw = readFileSync(source, "utf-8").trim();
    const bytes = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  }
  const decoded = bs58.decode(source);
  return Keypair.fromSecretKey(decoded);
}

export function saveKeypair(keypair: Keypair, path: string): void {
  const bytes = Array.from(keypair.secretKey);
  writeFileSync(path, JSON.stringify(bytes), { mode: 0o600 });
}

export function generateKeypair(): Keypair {
  return Keypair.generate();
}
