#!/usr/bin/env node
import { Command } from "commander";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  formatUsdc,
  getUsdcBalance,
  makeConnection,
  resolveNetwork,
  transferUsdc,
  usdc,
  type Cluster,
} from "@agentpay/sdk";
import {
  createWallet,
  readWallet,
  resolveWalletPath,
  walletExists,
} from "./wallet-store.js";

const program = new Command();

program
  .name("agentpay")
  .description("Pay-per-tool-call micropayments for AI agents (Solana + USDC + x402)")
  .version("0.0.1");

program
  .option("-w, --wallet <path>", "path to wallet keypair JSON")
  .option(
    "-c, --cluster <cluster>",
    "Solana cluster: 'devnet' or 'mainnet-beta'",
    "devnet"
  )
  .option("--rpc <url>", "override RPC URL");

interface GlobalOpts {
  wallet?: string;
  cluster?: Cluster;
  rpc?: string;
}

function getOpts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals();
}

function getNetwork(opts: GlobalOpts) {
  const args: { cluster: Cluster; rpcUrl?: string } = {
    cluster: opts.cluster ?? "devnet",
  };
  if (opts.rpc) args.rpcUrl = opts.rpc;
  return resolveNetwork(args);
}

const wallet = program.command("wallet").description("Manage local wallet");

wallet
  .command("new")
  .description("Generate a new wallet (fails if one already exists)")
  .option("--force", "overwrite existing wallet")
  .action(function (this: Command, localOpts: { force?: boolean }) {
    const opts = getOpts(this);
    const path = resolveWalletPath(opts.wallet);
    if (walletExists(path) && !localOpts.force) {
      console.error(`Wallet already exists at ${path}. Use --force to overwrite.`);
      process.exit(1);
    }
    const kp = createWallet(path);
    console.log(`Wallet created: ${path}`);
    console.log(`Public key:     ${kp.publicKey.toBase58()}`);
  });

wallet
  .command("show")
  .description("Print public key of the local wallet")
  .action(function (this: Command) {
    const opts = getOpts(this);
    const path = resolveWalletPath(opts.wallet);
    const kp = readWallet(path);
    console.log(`Path:       ${path}`);
    console.log(`Public key: ${kp.publicKey.toBase58()}`);
  });

program
  .command("balance")
  .description("Show SOL and USDC balance for the local wallet")
  .action(async function (this: Command) {
    const opts = getOpts(this);
    const network = getNetwork(opts);
    const connection = makeConnection(network);
    const path = resolveWalletPath(opts.wallet);
    const kp = readWallet(path);

    const lamports = await connection.getBalance(kp.publicKey);
    const usdcAmount = await getUsdcBalance(connection, network, kp.publicKey);

    console.log(`Cluster: ${network.cluster}`);
    console.log(`Address: ${kp.publicKey.toBase58()}`);
    console.log(`SOL:     ${lamports / LAMPORTS_PER_SOL}`);
    console.log(`USDC:    ${formatUsdc(usdcAmount)}`);
  });

program
  .command("send <to> <amount>")
  .description("Send USDC to another address. Amount in human-readable USDC, e.g. 0.05")
  .action(async function (this: Command, to: string, amount: string) {
    const opts = getOpts(this);
    const network = getNetwork(opts);
    const connection = makeConnection(network);
    const path = resolveWalletPath(opts.wallet);
    const kp = readWallet(path);

    let recipient: PublicKey;
    try {
      recipient = new PublicKey(to);
    } catch {
      console.error(`Invalid Solana address: ${to}`);
      process.exit(1);
    }

    const parsed = usdc(amount);
    console.log(
      `Sending ${formatUsdc(parsed)} USDC from ${kp.publicKey.toBase58()} to ${recipient.toBase58()} on ${network.cluster}...`
    );

    const sig = await transferUsdc({
      connection,
      network,
      from: kp,
      to: recipient,
      amount: parsed,
    });

    const explorerCluster =
      network.cluster === "mainnet-beta" ? "" : `?cluster=${network.cluster}`;
    console.log(`tx: ${sig}`);
    console.log(`explorer: https://explorer.solana.com/tx/${sig}${explorerCluster}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
