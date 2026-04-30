import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  generateKeypair,
  loadKeypair,
  saveKeypair,
} from "@agentpay/sdk";
import type { Keypair } from "@solana/web3.js";

export const DEFAULT_WALLET_PATH = join(homedir(), ".agentpay", "wallet.json");

export function resolveWalletPath(override?: string): string {
  return override ?? process.env.AGENTPAY_WALLET ?? DEFAULT_WALLET_PATH;
}

export function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function walletExists(path: string): boolean {
  return existsSync(path);
}

export function createWallet(path: string): Keypair {
  ensureDir(path);
  const keypair = generateKeypair();
  saveKeypair(keypair, path);
  return keypair;
}

export function readWallet(path: string): Keypair {
  if (!existsSync(path)) {
    throw new Error(
      `No wallet at ${path}. Run \`agentpay wallet new\` first or pass --wallet <path>.`
    );
  }
  return loadKeypair(path);
}
