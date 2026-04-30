export type Cluster = "mainnet-beta" | "devnet";

export interface UsdcAmount {
  /** Amount in USDC base units (1 USDC = 1_000_000 base units, 6 decimals). */
  baseUnits: bigint;
}

export const USDC_DECIMALS = 6;

export function usdc(human: number | string): UsdcAmount {
  const asNumber = typeof human === "string" ? Number(human) : human;
  if (!Number.isFinite(asNumber)) {
    throw new Error(`Invalid USDC amount: ${human}`);
  }
  const scaled = Math.round(asNumber * 10 ** USDC_DECIMALS);
  return { baseUnits: BigInt(scaled) };
}

export function formatUsdc(amount: UsdcAmount): string {
  const whole = amount.baseUnits / 1_000_000n;
  const fractional = amount.baseUnits % 1_000_000n;
  return `${whole}.${fractional.toString().padStart(6, "0")}`;
}
