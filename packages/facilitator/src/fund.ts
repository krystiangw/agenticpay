/**
 * Quick fund script: transfers SOL from the SDK's sender wallet to the
 * facilitator fee payer on devnet. Useful when the public devnet faucet is
 * rate-limited but you already have funded wallets nearby.
 *
 * Run: `pnpm --filter @agenticpay/facilitator fund [amountSol]`
 */
import { resolve } from "node:path";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { loadKeypair } from "@agenticpay/sdk";

const SENDER_PATH = resolve(
  process.cwd(),
  "../../packages/sdk/wallets/sender.json"
);
const FACILITATOR_PATH = resolve(
  process.cwd(),
  "./wallets/facilitator.json"
);

async function main() {
  const amountSol = Number(process.argv[2] ?? "0.05");
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  const sender = loadKeypair(SENDER_PATH);
  const facilitator = loadKeypair(FACILITATOR_PATH);

  const rpc = process.env.SOLANA_DEVNET_RPC ?? clusterApiUrl("devnet");
  const connection = new Connection(rpc, "confirmed");

  const before = await connection.getBalance(facilitator.publicKey);
  console.log(`Sender:      ${sender.publicKey.toBase58()}`);
  console.log(`Facilitator: ${facilitator.publicKey.toBase58()}`);
  console.log(`Before:      ${before / LAMPORTS_PER_SOL} SOL`);
  console.log(`Sending:     ${amountSol} SOL`);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: new PublicKey(facilitator.publicKey),
      lamports,
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [sender], {
    commitment: "confirmed",
  });

  const after = await connection.getBalance(facilitator.publicKey);
  console.log(`tx:          ${sig}`);
  console.log(`After:       ${after / LAMPORTS_PER_SOL} SOL`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
