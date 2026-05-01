/**
 * Real-world paywalled MCP server template.
 *
 * Each tool is backed by a real Claude API call. The agent calling these
 * tools gets actual research output (summaries, entity extraction,
 * sentiment, translation) — not a toy `reverseString` no one would pay
 * for in real life.
 *
 * Pricing tiers reflect real backend cost:
 *  - $0.001 USDC for cheap ops (sentiment, single-pass classification)
 *  - $0.003 USDC for medium ops (extract entities, short summary)
 *  - $0.005 USDC for heavy ops (long summary, translate)
 *
 * Run: `pnpm --filter @agenticpay/example-research-server dev`
 *
 * Required env: ANTHROPIC_API_KEY, PAY_TO (recipient pubkey).
 */
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { Network } from "@x402/core/types";
import Anthropic from "@anthropic-ai/sdk";

const PORT = Number(process.env.PORT ?? 4022);
const FACILITATOR_URL =
  process.env.FACILITATOR_URL ??
  "https://agentpay-facilitator-e9b20a5fee6a.herokuapp.com";
const NETWORK = (process.env.NETWORK ??
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") as Network;
const PAY_TO = process.env.PAY_TO;
const MODEL = process.env.MODEL ?? "claude-haiku-4-5-20251001";

if (!PAY_TO) {
  console.error("PAY_TO env var required (Solana pubkey that receives payments)");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY env var required (paid tools call Claude)");
  process.exit(1);
}

const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const usdcDevnet = (humanAmount: number) => ({
  asset: USDC_DEVNET_MINT,
  amount: Math.round(humanAmount * 1_000_000).toString(),
});

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator).register(
  NETWORK,
  new ExactSvmScheme()
);

const routes = {
  "POST /tools/summarize": {
    accepts: [
      {
        scheme: "exact" as const,
        price: usdcDevnet(0.005),
        network: NETWORK,
        payTo: PAY_TO,
      },
    ],
    description:
      "Summarize a long text. Returns a 1-3 sentence summary. Body: { text: string, length?: 'short' | 'medium' | 'long' }",
    mimeType: "application/json",
  },
  "POST /tools/extract_entities": {
    accepts: [
      {
        scheme: "exact" as const,
        price: usdcDevnet(0.003),
        network: NETWORK,
        payTo: PAY_TO,
      },
    ],
    description:
      "Extract named entities (people, organizations, locations) from text. Body: { text: string }",
    mimeType: "application/json",
  },
  "POST /tools/sentiment": {
    accepts: [
      {
        scheme: "exact" as const,
        price: usdcDevnet(0.001),
        network: NETWORK,
        payTo: PAY_TO,
      },
    ],
    description:
      "Classify the sentiment of a text as positive, negative, or neutral. Body: { text: string }",
    mimeType: "application/json",
  },
  "POST /tools/translate": {
    accepts: [
      {
        scheme: "exact" as const,
        price: usdcDevnet(0.005),
        network: NETWORK,
        payTo: PAY_TO,
      },
    ],
    description:
      "Translate text to a target language (English, Spanish, Polish, French, etc.). Body: { text: string, target_language: string }",
    mimeType: "application/json",
  },
};

const anthropic = new Anthropic();

function getText(req: express.Request): string {
  return String((req.body as { text?: unknown })?.text ?? "");
}

async function llm(prompt: string, maxTokens = 512): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  return textBlock?.text ?? "";
}

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/", (_req, res) => {
  res.json({
    service: "agenticpay-research-server",
    version: "0.0.1",
    network: NETWORK,
    facilitator: FACILITATOR_URL,
    payTo: PAY_TO,
    model: MODEL,
    tools: Object.entries(routes).map(([key, cfg]) => ({
      route: key,
      price: cfg.accepts[0]?.price,
      description: cfg.description,
    })) as unknown,
  });
});

app.use(paymentMiddleware(routes, resourceServer));

app.post("/tools/summarize", async (req, res) => {
  const text = getText(req);
  const length =
    (req.body as { length?: string })?.length ?? "medium";
  const lengthGuide =
    length === "short"
      ? "1 short sentence"
      : length === "long"
        ? "3-5 sentences"
        : "2-3 sentences";
  const prompt = `Summarize the following text in ${lengthGuide}. Return only the summary, no preamble.\n\nText:\n${text}`;
  const summary = await llm(prompt, 256);
  res.json({ summary });
});

app.post("/tools/extract_entities", async (req, res) => {
  const text = getText(req);
  const prompt = `Extract named entities from the text. Return a JSON object with keys "people", "organizations", "locations" — each an array of unique strings. Return only valid JSON, no preamble.\n\nText:\n${text}`;
  const raw = await llm(prompt, 512);
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    res.json({ entities: JSON.parse(cleaned) });
  } catch {
    res.json({ entities: { raw } });
  }
});

app.post("/tools/sentiment", async (req, res) => {
  const text = getText(req);
  const prompt = `Classify the sentiment of this text as exactly one of: positive, negative, neutral. Return only the single word, no preamble.\n\nText:\n${text}`;
  const out = await llm(prompt, 16);
  const label = out.trim().toLowerCase().split(/\s+/)[0] ?? "unknown";
  res.json({ sentiment: label });
});

app.post("/tools/translate", async (req, res) => {
  const text = getText(req);
  const target = String(
    (req.body as { target_language?: unknown })?.target_language ?? "English"
  );
  const prompt = `Translate the following text into ${target}. Return only the translation, no preamble.\n\nText:\n${text}`;
  const translated = await llm(prompt, 1024);
  res.json({ translated, target_language: target });
});

app.listen(PORT, () => {
  console.log(`agenticpay research-server listening on http://localhost:${PORT}`);
  console.log(`network:     ${NETWORK}`);
  console.log(`facilitator: ${FACILITATOR_URL}`);
  console.log(`payTo:       ${PAY_TO}`);
  console.log(`model:       ${MODEL}`);
  for (const [key, cfg] of Object.entries(routes)) {
    const p = cfg.accepts[0]?.price;
    console.log(`  ${key.padEnd(34)} -> ${p?.amount} base units USDC`);
  }
});
