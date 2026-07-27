/**
 * Bazaar resource catalog backing `GET /discovery/resources`.
 *
 * x402 spec v2 §8 puts the discovery index on the facilitator: resource servers
 * advertise their endpoint spec in the 402 response via the `bazaar` extension,
 * and the facilitator that sees their payments catalogs them so clients can
 * find monetized services. We sit in exactly that position but never recorded
 * anything, so our /discovery/resources was a 404.
 *
 * The catalog is deliberately in-memory. A dyno restart empties it and it
 * refills from live traffic — acceptable because every entry is derived from an
 * observed payment anyway, so a persisted index would go stale in the same way.
 * Swap in a store here if the index ever needs to outlive the process.
 */
import type { Network } from "@x402/core/types";

/** A single catalog entry, shaped per spec v2 §8.3 (Discovered Resource Fields). */
export interface DiscoveredResource {
  resource: string;
  type: string;
  x402Version: number;
  accepts: Record<string, unknown>[];
  lastUpdated: number;
  extensions?: Record<string, unknown>;
}

// Every field is spelled `| undefined` because the package builds with
// exactOptionalPropertyTypes, and the router always passes all seven keys —
// absent query params arrive as an explicit undefined rather than being omitted.
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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class ResourceCatalog {
  private readonly entries = new Map<string, DiscoveredResource>();

  /**
   * Record a resource we just saw a *valid* payment for.
   *
   * Only ever call this after a successful verify. The `resource` field is
   * attacker-controlled, so gating on verification means listing an entry costs
   * a genuinely signed payment payload rather than an anonymous POST — that is
   * what keeps this index from becoming an open link farm.
   */
  record(
    paymentRequirements: Record<string, unknown> | undefined,
    x402Version: unknown
  ): void {
    const resource = normalizeResourceUrl(paymentRequirements?.resource);
    if (!resource) return;

    const extensions = isPlainObject(paymentRequirements?.extensions)
      ? (paymentRequirements.extensions as Record<string, unknown>)
      : undefined;

    const existing = this.entries.get(resource);
    const accepts = mergeAccepts(existing?.accepts, paymentRequirements!);

    // Re-inserting moves the key to the end of the Map's iteration order, which
    // is what makes the eviction below least-recently-updated rather than
    // arbitrary.
    this.entries.delete(resource);
    this.entries.set(resource, {
      resource,
      type: resourceType(extensions),
      x402Version: typeof x402Version === "number" ? x402Version : 2,
      accepts,
      lastUpdated: Math.floor(Date.now() / 1000),
      ...(extensions ? { extensions } : {}),
    });

    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Filter + paginate per spec v2 §8.1. */
  query(q: DiscoveryQuery): {
    x402Version: number;
    items: DiscoveredResource[];
    pagination: { limit: number; offset: number; total: number };
  } {
    const limit = clampInt(q.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(q.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    // Newest first, so a client paging through the index sees the most recently
    // active resources before the stale tail. We reverse the Map's own order
    // rather than sorting on lastUpdated: that field is whole seconds, so every
    // resource recorded within the same second would tie and the ordering would
    // collapse. Insertion order is exact, because record() re-inserts on update
    // and eviction drops from the front.
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
 * we already knew about and add this requirement if it is new. Deduped on the
 * (scheme, network, asset, payTo, amount) tuple — the fields that actually
 * distinguish one way of paying from another.
 */
function mergeAccepts(
  existing: Record<string, unknown>[] | undefined,
  incoming: Record<string, unknown>
): Record<string, unknown>[] {
  const key = (r: Record<string, unknown>) =>
    [r.scheme, r.network, r.asset, r.payTo, r.amount].join("|");

  const merged = existing ? [...existing] : [];
  const incomingKey = key(incoming);
  const at = merged.findIndex((r) => key(r) === incomingKey);
  if (at >= 0) merged[at] = incoming;
  else merged.push(incoming);

  // Same bounding rationale as MAX_ENTRIES: one resource must not be able to
  // grow without limit by varying the amount on every request.
  return merged.slice(-20);
}

/**
 * Spec v2 §8.3 only standardizes "http" today; the bazaar extension carries an
 * `input.type` that also allows "mcp", so prefer that when a resource declares it.
 */
function resourceType(extensions: Record<string, unknown> | undefined): string {
  const bazaar = extensions?.bazaar;
  if (!isPlainObject(bazaar)) return "http";
  const info = (bazaar as Record<string, unknown>).info;
  if (!isPlainObject(info)) return "http";
  const input = (info as Record<string, unknown>).input;
  if (!isPlainObject(input)) return "http";
  const type = (input as Record<string, unknown>).type;
  return typeof type === "string" && type.length > 0 ? type : "http";
}

function hasExtension(e: DiscoveredResource, key: string): boolean {
  return Boolean(e.extensions && Object.hasOwn(e.extensions, key));
}

function acceptsSome(
  e: DiscoveredResource,
  field: string,
  value: string
): boolean {
  return e.accepts.some((a) => a[field] === value);
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

/** Re-exported so index.ts can keep its network typing consistent. */
export type { Network };
