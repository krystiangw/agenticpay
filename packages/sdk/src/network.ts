import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import type { Cluster } from "./types.js";

/**
 * Canonical USDC SPL mint addresses.
 * Mainnet: Circle's official USDC.
 * Devnet: Circle's faucet-mint (https://faucet.circle.com).
 */
export const USDC_MINT: Record<Cluster, PublicKey> = {
  "mainnet-beta": new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  devnet: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
};

export interface NetworkConfig {
  cluster: Cluster;
  rpcUrl: string;
  usdcMint: PublicKey;
}

export function resolveNetwork(opts?: {
  cluster?: Cluster;
  rpcUrl?: string;
}): NetworkConfig {
  const cluster: Cluster = opts?.cluster ?? "devnet";
  const envRpc =
    cluster === "mainnet-beta"
      ? process.env.SOLANA_MAINNET_RPC
      : process.env.SOLANA_DEVNET_RPC;
  const rpcUrl = opts?.rpcUrl ?? envRpc ?? clusterApiUrl(cluster);
  return {
    cluster,
    rpcUrl,
    usdcMint: USDC_MINT[cluster],
  };
}

export function makeConnection(network: NetworkConfig): Connection {
  return new Connection(network.rpcUrl, "confirmed");
}
