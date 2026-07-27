/**
 * Bazaar resource catalog backing `GET /discovery/resources`.
 *
 * x402 spec v2 §8 puts the discovery index on the facilitator: resource servers
 * advertise their endpoint spec in the 402 response via the `bazaar` extension,
 * and the facilitator that handles their payments catalogs them so clients can
 * find monetized services. We sit in exactly that position but served nothing,
 * so our /discovery/resources was a 404.
 *
 * The response shape follows `DiscoveryResource` / `DiscoveryResourcesResponse`
 * from @x402/extensions rather than the prose in spec §8.3, because those two
 * disagree on `lastUpdated` — the spec text says a Unix number, the SDK type
 * says an ISO 8601 string. Clients are built against the SDK types, so the SDK
 * is the contract that actually has to hold.
 *
 * The catalog is deliberately in-memory. A dyno restart empties it and it
 * refills from live traffic — acceptable because every entry is derived from an
 * observed settlement anyway, so a persisted index would go stale in the same
 * way. Swap in a store behind this class if the index ever needs to outlive the
 * process.
 */
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { extractDiscoveryInfo } from "@x402/extensions/bazaar";

/** Mirrors `DiscoveryResource` from @x402/extensions. */
export interface DiscoveredResource {
  resource: string;
  type: string;
  x402Version: number;
  accepts: PaymentRequirements[];
  /** ISO 8601, per the SDK type. */
  lastUpdated: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  extensions?: Record<string, unknown>;
}

/**
 * Mirrors `ListDiscoveryResourcesParams`, except limit/offset stay `unknown`
 * because ours arrive as raw query strings and are clamped below.
 */
export interface DiscoveryQuery {
  type?: string | undefined;
  payTo?: string | undefined;
  scheme?: string | undefined;
  network?: string | undefined;
  extensions?: string | undefined;
  limit?: unknown;
  offset?: unknown;
}

// An unauthenticated index is an obvious spam target, so it is bounded. When
// full we evict the least recently updated entry — a resource nobody has paid
// for in a while is the one we care least about advertising.
const MAX_ENTRIES = 1000;

// Long enough for real API URLs, short enough that nobody can pad the index
// with megabyte-sized strings.
const MAX_RESOURCE_URL_LENGTH = 2048;

// `description` and `mimeType` are free text the payer controls and the SDK
// sanitizer does not cover, so bound them here.
const MAX_DESCRIPTION_LENGTH = 512;
const MAX_MIME_TYPE_LENGTH = 128;

// The extension echo is attacker-controlled and the body parser admits 256 KB,
// so retaining it verbatim would let 1000 entries pin ~256 MB — more than the
// dyno has. Keep only the bazaar declaration, and only when it serializes
// small enough to be worth echoing.
const MAX_EXTENSIONS_BYTES = 8 * 1024;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class ResourceCatalog {
  private readonly entries = new Map<string, DiscoveredResource>();

  /**
   * Record a resource from a settled payment.
   *
   * Call this only after a *settlement* succeeds. Verification alone is not
   * enough: verifying does not consume the payment, so one valid payload could
   * be replayed indefinitely to stuff the index with arbitrary URLs. Settling
   * puts the transaction on chain, which cannot be replayed and costs the payer
   * real value — that is what keeps this public index from becoming a link farm.
   *
   * `requirements` must be the object settlement validated against, not
   * `payload.accepted`. The two are separate inputs and a caller is free to
   * disagree with itself: settlement checks the transfer against the former, so
   * publishing the latter would advertise asset/payTo/amount terms that were
   * never actually settled.
   */
  record(
    payload: PaymentPayload | undefined,
    requirements: PaymentRequirements | undefined
  ): void {
    if (!payload || !requirements) return;

    // The bazaar extension is the resource server's opt-in to being listed, and
    // it is what carries the invocation metadata that makes an entry useful.
    // extractDiscoveryInfo validates the declaration against its own schema and
    // yields null when there isn't a usable one, so a plain payment — or a
    // malformed declaration — is simply not indexed. It throws on validation
    // failure, hence the guard.
    let discovered;
    try {
      discovered = extractDiscoveryInfo(payload, requirements);
    } catch {
      return;
    }
    if (!discovered) return;

    const resource = normalizeResourceUrl(discovered.resourceUrl);
    if (!resource) return;

    const existing = this.entries.get(resource);
    const accepts = mergeAccepts(existing?.accepts, requirements);

    const description = boundedText(
      discovered.description,
      MAX_DESCRIPTION_LENGTH
    );
    const mimeType = boundedText(discovered.mimeType, MAX_MIME_TYPE_LENGTH);
    const extensions = boundedExtensions(discovered.extensions);

    // Re-inserting moves the key to the end of the Map's iteration order, which
    // is what makes the eviction below least-recently-updated rather than
    // arbitrary.
    this.entries.delete(resource);
    this.entries.set(resource, {
      resource,
      // The SDK discriminates the two resource kinds by shape: an MCP tool
      // carries toolName, an HTTP endpoint carries method.
      type: "toolName" in discovered ? "mcp" : "http",
      x402Version:
        typeof discovered.x402Version === "number" ? discovered.x402Version : 2,
      accepts,
      lastUpdated: new Date().toISOString(),
      ...(description ? { description } : {}),
      ...(mimeType ? { mimeType } : {}),
      // serviceName / tags / iconUrl arrive already sanitized by the SDK.
      ...(discovered.serviceName ? { serviceName: discovered.serviceName } : {}),
      ...(discovered.tags ? { tags: discovered.tags } : {}),
      ...(discovered.iconUrl ? { iconUrl: discovered.iconUrl } : {}),
      ...(extensions ? { extensions } : {}),
    });

    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Filter + paginate per spec v2 §8.1 / `ListDiscoveryResourcesParams`. */
  query(q: DiscoveryQuery): {
    x402Version: number;
    items: DiscoveredResource[];
    pagination: { limit: number; offset: number; total: number };
  } {
    const limit = clampInt(q.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(q.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    // Newest first, so a client paging through the index sees the most recently
    // active resources before the stale tail. We reverse the Map's own order
    // rather than sorting on lastUpdated: two resources recorded in the same
    // millisecond tie, and insertion order is exact anyway, because record()
    // re-inserts on update and eviction drops from the front.
    const matched = [...this.entries.values()]
      .reverse()
      .filter((e) => !q.type || e.type === q.type)
      .filter((e) => !q.extensions || hasExtension(e, q.extensions))
      .filter((e) => !q.payTo || acceptsSome(e, "payTo", q.payTo))
      .filter((e) => !q.scheme || acceptsSome(e, "scheme", q.scheme))
      .filter((e) => !q.network || acceptsSome(e, "network", q.network));

    return {
      x402Version: 2,
      items: matched.slice(offset, offset + limit),
      pagination: { limit, offset, total: matched.length },
    };
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Accept only absolute http(s) URLs, and strip any fragment/credentials so two
 * spellings of the same endpoint collapse to one entry instead of two.
 * Returns null for anything we won't index.
 */
function normalizeResourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_RESOURCE_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  url.username = "";
  url.password = "";
  const normalized = url.toString();
  return normalized.length > MAX_RESOURCE_URL_LENGTH ? null : normalized;
}

/**
 * A resource can be reachable under several payment options, so keep the ones
 * we already knew about and add this one if it is new. Deduped on the
 * (scheme, network, asset, payTo, amount) tuple — the fields that actually
 * distinguish one way of paying from another.
 */
function mergeAccepts(
  existing: PaymentRequirements[] | undefined,
  incoming: PaymentRequirements | undefined
): PaymentRequirements[] {
  const merged = existing ? [...existing] : [];
  if (!incoming) return merged;

  const key = (r: PaymentRequirements) =>
    [r.scheme, r.network, r.asset, r.payTo, r.amount].join("|");

  const incomingKey = key(incoming);
  const at = merged.findIndex((r) => key(r) === incomingKey);
  if (at >= 0) merged[at] = incoming;
  else merged.push(incoming);

  // Same bounding rationale as MAX_ENTRIES: one resource must not be able to
  // grow without limit by varying the amount on every settlement.
  return merged.slice(-20);
}

/**
 * Echo back only the bazaar declaration, and only while it stays small. Every
 * other extension key is irrelevant to discovery, and echoing the whole object
 * would let one settlement pin an arbitrary slice of the 256 KB request body in
 * memory — and re-serve it on every paginated response.
 */
function boundedExtensions(
  raw: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const bazaar = raw.bazaar;
  if (!isPlainObject(bazaar)) return undefined;

  let serialized: string;
  try {
    serialized = JSON.stringify(bazaar);
  } catch {
    return undefined;
  }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_EXTENSIONS_BYTES) {
    return undefined;
  }
  return { bazaar };
}

function hasExtension(e: DiscoveredResource, key: string): boolean {
  return Boolean(e.extensions && Object.hasOwn(e.extensions, key));
}

function acceptsSome(
  e: DiscoveredResource,
  field: keyof PaymentRequirements,
  value: string
): boolean {
  return e.accepts.some((a) => a[field] === value);
}

/** Trim free-text metadata to a sane length, or drop it entirely. */
function boundedText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, max);
}

/** Query strings arrive as text, so parse defensively and fall back to the default. */
function clampInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
