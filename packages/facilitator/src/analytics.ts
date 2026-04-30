import { createHash } from "node:crypto";
import { PostHog } from "posthog-node";

/**
 * PostHog wrapper that no-ops when no API key is configured. Designed for the
 * facilitator: backend events are anonymous, payer pubkeys are hashed before
 * use as distinctId so we get unique-payer counts without leaking addresses
 * to PostHog.
 */
class Analytics {
  private client: PostHog | null = null;

  init(apiKey: string | undefined, host?: string) {
    if (!apiKey) {
      console.log("[analytics] disabled (no POSTHOG_API_KEY)");
      return;
    }
    this.client = new PostHog(apiKey, {
      host: host ?? "https://us.i.posthog.com",
      flushAt: 5,
      flushInterval: 5000,
    });
    console.log("[analytics] enabled");
  }

  /** Hash a payer pubkey so we can dedupe users without revealing addresses. */
  private payerId(payer: string | undefined): string {
    if (!payer) return "anon";
    return "p_" + createHash("sha256").update(payer).digest("hex").slice(0, 16);
  }

  capture(
    event: string,
    payer: string | undefined,
    properties: Record<string, unknown> = {}
  ) {
    if (!this.client) return;
    try {
      this.client.capture({
        distinctId: this.payerId(payer),
        event,
        properties: {
          $process_person_profile: false,
          ...properties,
        },
      });
    } catch (err) {
      console.warn("[analytics] capture failed:", (err as Error).message);
    }
  }

  async shutdown() {
    if (this.client) await this.client.shutdown();
  }
}

export const analytics = new Analytics();
