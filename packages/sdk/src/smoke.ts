/**
 * Smoke test: validates the SDK end-to-end against Solana devnet.
 *
 * On first run this generates a sender keypair, persists it to
 * `./wallets/sender.json`, and (if needed) requests a SOL airdrop. To get
 * USDC: visit https://faucet.circle.com, choose Solana Devnet, and paste the
 * sender pubkey printed below. Re-run the script after funding.
 *
 * If the public devnet RPC rejects the airdrop (often rate-limited),
 * either run again, set SOLANA_DEVNET_RPC to a personal endpoint
 * (e.g. Helius free tier), or fund the sender pubkey via
 * https://faucet.solana.com manually.
 *
 * Run: `pnpm --filter @agentpay/sdk smoke`
 */
import { existsSync, mkdirSync } from "node:fs";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  formatUsdc,
  generateKeypair,
  getUsdcBalance,
  loadKeypair,
  makeConnection,
  resolveNetwork,
  saveKeypair,
  transferUsdc,
  usdc,
} from "./index.js";

const SENDER_PATH = "./wallets/sender.json";
const RECIPIENT_PATH = "./wallets/recipient.json";
const MIN_SOL_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;

function loadOrCreate(path: string) {
  if (existsSync(path)) return { keypair: loadKeypair(path), created: false };
  mkdirSync("./wallets", { recursive: true });
  const keypair = generateKeypair();
  saveKeypair(keypair, path);
  return { keypair, created: true };
}

async function airdropWithRetry(
  connection: Awaited<ReturnType<typeof makeConnection>>,
  pubkey: import("@solana/web3.js").PublicKey,
  attempts = 3
) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const sig = await connection.requestAirdrop(pubkey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      return;
    } catch (err) {
      console.warn(`  airdrop attempt ${i}/${attempts} failed: ${(err as Error).message}`);
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function main() {
  const network = resolveNetwork({ cluster: "devnet" });
  const connection = makeConnection(network);

  const sender = loadOrCreate(SENDER_PATH);
  const recipient = loadOrCreate(RECIPIENT_PATH);

  console.log("Network:    ", network.cluster, network.rpcUrl);
  console.log("USDC mint:  ", network.usdcMint.toBase58());
  console.log(
    "Sender:     ",
    sender.keypair.publicKey.toBase58(),
    sender.created ? "(new)" : "(loaded)"
  );
  console.log(
    "Recipient:  ",
    recipient.keypair.publicKey.toBase58(),
    recipient.created ? "(new)" : "(loaded)"
  );
  console.log();

  const senderLamports = await connection.getBalance(sender.keypair.publicKey);
  console.log(`Sender SOL: ${senderLamports / LAMPORTS_PER_SOL}`);

  if (senderLamports < MIN_SOL_LAMPORTS) {
    console.log("Requesting SOL airdrop (devnet)...");
    try {
      await airdropWithRetry(connection, sender.keypair.publicKey);
      const after = await connection.getBalance(sender.keypair.publicKey);
      console.log(`  airdropped. Sender SOL: ${after / LAMPORTS_PER_SOL}`);
    } catch (err) {
      console.error("  all airdrop attempts failed.");
      console.error("  fallback options:");
      console.error("    1) https://faucet.solana.com  (paste sender pubkey)");
      console.error("    2) export SOLANA_DEVNET_RPC=<your Helius/QuickNode devnet URL>");
      console.error(`    3) solana airdrop 1 ${sender.keypair.publicKey.toBase58()} --url devnet`);
      process.exit(1);
    }
  }

  console.log();
  const senderUsdc = await getUsdcBalance(
    connection,
    network,
    sender.keypair.publicKey
  );
  console.log(`Sender USDC: ${formatUsdc(senderUsdc)}`);

  if (senderUsdc.baseUnits === 0n) {
    console.log();
    console.log("Sender has 0 USDC on devnet. To proceed:");
    console.log("  1. Open https://faucet.circle.com");
    console.log("  2. Choose 'Solana Devnet'");
    console.log(`  3. Paste address: ${sender.keypair.publicKey.toBase58()}`);
    console.log("  4. Re-run this smoke test (sender keypair is persisted to wallets/sender.json).");
    return;
  }

  console.log();
  console.log("Transferring 0.01 USDC...");
  const txSig = await transferUsdc({
    connection,
    network,
    from: sender.keypair,
    to: recipient.keypair.publicKey,
    amount: usdc(0.01),
  });
  console.log("tx:", txSig);
  console.log(
    `explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`
  );

  const recipientUsdc = await getUsdcBalance(
    connection,
    network,
    recipient.keypair.publicKey
  );
  console.log(`Recipient USDC: ${formatUsdc(recipientUsdc)}`);
  console.log("OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
