import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import type { NetworkConfig } from "./network.js";
import { USDC_DECIMALS, type UsdcAmount } from "./types.js";

export function getUsdcAta(network: NetworkConfig, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(network.usdcMint, owner);
}

export async function getUsdcBalance(
  connection: Connection,
  network: NetworkConfig,
  owner: PublicKey
): Promise<UsdcAmount> {
  const ata = getUsdcAta(network, owner);
  try {
    const account = await getAccount(connection, ata);
    return { baseUnits: account.amount };
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) {
      return { baseUnits: 0n };
    }
    throw err;
  }
}

/**
 * Transfer USDC from `from` to `to`. Creates the destination ATA if it does not
 * exist (the payer also funds rent for the new account, ~0.002 SOL).
 *
 * Returns the transaction signature.
 */
export async function transferUsdc(params: {
  connection: Connection;
  network: NetworkConfig;
  from: Keypair;
  to: PublicKey;
  amount: UsdcAmount;
}): Promise<string> {
  const { connection, network, from, to, amount } = params;

  const fromAta = getUsdcAta(network, from.publicKey);
  const toAta = getUsdcAta(network, to);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      from.publicKey,
      toAta,
      to,
      network.usdcMint
    ),
    createTransferCheckedInstruction(
      fromAta,
      network.usdcMint,
      toAta,
      from.publicKey,
      amount.baseUnits,
      USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  return sendAndConfirmTransaction(connection, tx, [from], {
    commitment: "confirmed",
  });
}
