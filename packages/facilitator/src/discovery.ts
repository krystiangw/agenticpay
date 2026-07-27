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
import {
  extractDiscoveryInfo,
  validateDiscoveryExtensionSpec,
} from "@x402/extensions/bazaar";

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
// dyno has. Echo the whole extensions object only while it stays under this
// aggregate bound, so `?extensions=<key>` keeps working for keys other than
// bazaar.
const MAX_EXTENSIONS_BYTES = 8 * 1024;

// PaymentRequirements.extra is a free-form record the scheme ignores, so a
// payer can pad it toward the body limit. We keep it — clients need things like
// the USDC name/version to build a payment — but only while it stays small.
const MAX_EXTRA_BYTES = 2 * 1024;

// A day. Generous for any real payment window, and finite.
const MAX_TIMEOUT_SECONDS = 86_400;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class ResourceCatalog {
  /**
   * Entries keyed by resource URL, each tagged with the payTo that first
   * listed it. See `record()` for why ownership is tracked.
   */
  private readonly entries = new Map<
    string,
    { owner: string; entry: DiscoveredResource }
  >();

  /**
   * When non-empty, only settlements paying one of these addresses are
   * indexed. x402 gives a facilitator no way to tell a resource server's own
   * declaration from any payer's (see `record()`), so an operator who needs a
   * trustworthy index curates it by payee.
   */
  private readonly allowedPayTo: ReadonlySet<string>;

  constructor(allowedPayTo: Iterable<string> = []) {
    this.allowedPayTo = new Set(allowedPayTo);
  }

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
   *
   * Trust model, stated plainly: settling proves the transfer matched
   * `requirements`. It proves nothing about `payload.resource` or
   * `payload.extensions` — the SVM scheme neither binds nor authenticates them,
   * and x402 gives the facilitator no signature from the resource server to
   * check. So anyone willing to settle a real payment can list a URL of their
   * choosing. Two things bound the damage, but neither closes the hole:
   *
   *   - a listing belongs to the payTo that created it, so a later settlement
   *     paying someone else cannot rewrite an existing resource's metadata;
   *   - an operator can pass an allowlist and index only their own payees.
   *
   * Treat an unrestricted index as "resources someone paid for through this
   * facilitator, as described by the payer" — not as a vouched-for catalog.
   */
  record(
    payload: PaymentPayload | undefined,
    requirements: PaymentRequirements | undefined
  ): void {
    if (!payload || !requirements) return;

    // The bazaar extension is the resource server's opt-in to being listed and
    // carries the invocation metadata that makes an entry useful, so a plain
    // payment is never indexed.
    //
    // Two validation steps, because they check different things and only one of
    // them is trustworthy on its own. extractDiscoveryInfo checks `info`
    // against the `schema` sitting next to it — but the payer authors both, so
    // a declaration shipping a permissive schema validates against itself and
    // proves nothing. validateDiscoveryExtensionSpec enforces the fixed
    // protocol invariants instead (input.type is http or mcp, HTTP methods are
    // real methods, MCP declares toolName and inputSchema), which is what stops
    // us cataloging a self-consistent but malformed resource.
    const declaration = isPlainObject(payload.extensions)
      ? payload.extensions.bazaar
      : undefined;
    if (!isPlainObject(declaration)) return;
    if (!validateDiscoveryExtensionSpec(declaration).valid) return;

    let discovered;
    try {
      discovered = extractDiscoveryInfo(payload, requirements);
    } catch {
      return;
    }
    if (!discovered) return;

    const resource = normalizeResourceUrl(discovered.resourceUrl);
    if (!resource) return;

    const terms = sanitizeRequirements(requirements);
    if (!terms) return;

    if (this.allowedPayTo.size > 0 && !this.allowedPayTo.has(terms.payTo)) {
      return;
    }

    // First payee to list a resource keeps it. Without this, anyone able to
    // settle could point an existing listing at their own declaration.
    const existing = this.entries.get(resource);
    if (existing && existing.owner !== terms.payTo) return;

    const accepts = mergeAccepts(existing?.entry.accepts, terms);

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
      owner: terms.payTo,
      entry: {
        resource,
        // The SDK discriminates the two resource kinds by shape: an MCP tool
        // carries toolName, an HTTP endpoint carries method.
        type: "toolName" in discovered ? "mcp" : "http",
        x402Version:
          typeof discovered.x402Version === "number"
            ? discovered.x402Version
            : 2,
        accepts,
        lastUpdated: new Date().toISOString(),
        ...(description ? { description } : {}),
        ...(mimeType ? { mimeType } : {}),
        // serviceName / tags / iconUrl arrive already sanitized by the SDK.
        ...(discovered.serviceName
          ? { serviceName: discovered.serviceName }
          : {}),
        ...(discovered.tags ? { tags: discovered.tags } : {}),
        ...(discovered.iconUrl ? { iconUrl: discovered.iconUrl } : {}),
        ...(extensions ? { extensions } : {}),
      },
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
      .map((held) => held.entry)
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
 * Copy across only the fields discovery publishes, checking each one's runtime
 * type and size. Returns null if anything looks wrong, which keeps the resource
 * out of the index entirely.
 *
 * Nothing upstream does this for us: PaymentRequirements arrives straight from
 * JSON, x402Facilitator.settle() does not apply the SDK schema, and the SVM
 * scheme only looks at the fields it needs — so `maxTimeoutSeconds` could just
 * as well be a 256 KB string and still ride along on a perfectly good
 * settlement. `extra` gets the same treatment for the same reason: it is
 * free-form, the scheme ignores unknown keys, and 20 options across 1000
 * resources is enough padding to exhaust the process.
 */
function sanitizeRequirements(r: PaymentRequirements): PaymentRequirements | null {
  const scheme = boundedField(r.scheme, 64);
  const network = boundedField(r.network, 128);
  const asset = boundedField(r.asset, 128);
  const payTo = boundedField(r.payTo, 128);
  // Base units, so digits only — and short enough that no legitimate amount is
  // anywhere near the bound.
  const amount = boundedField(r.amount, 40);
  if (!scheme || !network || !asset || !payTo || !amount) return null;
  if (!/^\d+$/.test(amount)) return null;

  // Must be positive: the x402 PaymentRequirements schema says so, and the SVM
  // scheme never reads the field, so a settlement carrying 0 would otherwise
  // sail through and leave us publishing an entry that schema-validating
  // discovery clients reject.
  const timeout = r.maxTimeoutSeconds;
  if (
    typeof timeout !== "number" ||
    !Number.isInteger(timeout) ||
    timeout <= 0 ||
    timeout > MAX_TIMEOUT_SECONDS
  ) {
    return null;
  }

  // `extra` carries scheme-critical data — ExactSvmScheme will not settle
  // without extra.feePayer — so it cannot be emptied to fit a bound; that would
  // advertise a payment option nobody can actually use. Real ones are tiny, so
  // an oversized `extra` is anomalous and the whole record is dropped instead.
  if (!isPlainObject(r.extra) || !withinBytes(r.extra, MAX_EXTRA_BYTES)) {
    return null;
  }

  return {
    scheme,
    network: network as PaymentRequirements["network"],
    asset,
    amount,
    payTo,
    maxTimeoutSeconds: timeout,
    extra: r.extra,
  };
}

/** A non-empty string within `max` characters, or undefined. */
function boundedField(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  if (raw.length === 0 || raw.length > max) return undefined;
  return raw;
}

/**
 * Echo the extensions object back, but bounded.
 *
 * Every key is kept, not just `bazaar`: the endpoint advertises the SDK's
 * `?extensions=<key>` filter, so dropping the other keys would silently make
 * that filter unable to match anything else. The aggregate size bound is what
 * keeps one settlement from pinning an arbitrary slice of the request body in
 * memory and re-serving it on every paginated response.
 */
function boundedExtensions(
  raw: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!isPlainObject(raw)) return undefined;
  if (withinBytes(raw, MAX_EXTENSIONS_BYTES)) return raw;

  // Too big as a whole: fall back to the declaration that earned the listing,
  // if that alone fits. Otherwise echo nothing — the resource stays indexed.
  const bazaar = raw.bazaar;
  if (isPlainObject(bazaar) && withinBytes({ bazaar }, MAX_EXTENSIONS_BYTES)) {
    return { bazaar };
  }
  return undefined;
}

/** True when the value serializes to JSON within `max` bytes. */
function withinBytes(value: unknown, max: number): boolean {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  if (serialized === undefined) return false;
  return Buffer.byteLength(serialized, "utf8") <= max;
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
