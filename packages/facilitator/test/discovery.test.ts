/**
 * Tests for the Bazaar resource catalog behind GET /discovery/resources.
 *
 * The catalog publishes a public index built from payer-supplied data, so most
 * of what is asserted here is what it *refuses* to publish. Several cases are
 * regressions for defects found in review — they are labelled as such, because
 * a test whose reason is forgotten is a test someone deletes.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ResourceCatalog } from "../src/discovery.js";

const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const PAYEE = "PayToAAA";

/** Catalog that publishes anything, so a test can focus on one rule at a time. */
const openCatalog = (payee = PAYEE) => new ResourceCatalog([["*", payee]]);

function reqs(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK as PaymentRequirements["network"],
    asset: "USDC",
    payTo: PAYEE,
    amount: "1000",
    maxTimeoutSeconds: 60,
    extra: {},
    ...over,
  };
}

/** A bazaar declaration that passes both the schema and the protocol rules. */
function httpDeclaration(input: Record<string, unknown> = { type: "http", method: "GET" }) {
  return {
    bazaar: {
      info: { input, output: { type: "json", example: { ok: true } } },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          input: {
            type: "object",
            properties: { type: { type: "string" }, method: { type: "string" } },
            required: ["type"],
          },
          output: { type: "object", properties: { type: { type: "string" } }, required: ["type"] },
        },
        required: ["input"],
      },
    },
  };
}

const mcpDeclaration = () =>
  httpDeclaration({ type: "mcp", toolName: "search", inputSchema: { type: "object" } });

function payload(over: {
  url?: string | undefined;
  resource?: Record<string, unknown> | null;
  accepted?: PaymentRequirements;
  extensions?: Record<string, unknown> | null;
  x402Version?: number;
} = {}): PaymentPayload {
  const resource =
    over.resource === null
      ? undefined
      : { url: over.url ?? "https://api.example.com/data", ...(over.resource ?? {}) };
  return {
    x402Version: over.x402Version ?? 2,
    ...(resource ? { resource } : {}),
    accepted: over.accepted ?? reqs(),
    payload: {},
    ...(over.extensions === null ? {} : { extensions: over.extensions ?? httpDeclaration() }),
  } as PaymentPayload;
}

describe("shape of the response", () => {
  test("an empty catalog still answers with the SDK contract", () => {
    const r = openCatalog().query({});
    assert.equal(r.x402Version, 2);
    assert.deepEqual(r.items, []);
    assert.deepEqual(r.pagination, { limit: 20, offset: 0, total: 0 });
  });

  test("lastUpdated is an ISO 8601 string, not epoch seconds", () => {
    // The prose in spec §8.3 says a Unix number; @x402/extensions declares a
    // string. Clients compile against the SDK type, so the SDK wins.
    const c = openCatalog();
    c.record(payload(), reqs());
    const { lastUpdated } = c.query({}).items[0]!;
    assert.equal(typeof lastUpdated, "string");
    assert.match(lastUpdated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(!Number.isNaN(Date.parse(lastUpdated)));
  });
});

describe("listing requires the resource server to opt in", () => {
  test("an ordinary payment carrying no bazaar declaration is not indexed", () => {
    const c = openCatalog();
    c.record(payload({ extensions: null }), reqs());
    assert.equal(c.size, 0);
  });

  test("an empty or malformed declaration is not indexed", () => {
    const c = openCatalog();
    for (const ext of [{}, { bazaar: {} }, { bazaar: null }, { bazaar: [] }, { bazaar: "x" }]) {
      c.record(payload({ extensions: ext as Record<string, unknown> }), reqs());
    }
    assert.equal(c.size, 0);
  });

  test("a declaration without a schema fails validation", () => {
    const c = openCatalog();
    c.record(
      payload({ extensions: { bazaar: { info: { input: { type: "http", method: "GET" } } } } }),
      reqs()
    );
    assert.equal(c.size, 0);
  });

  test("a complete declaration is indexed", () => {
    const c = openCatalog();
    c.record(payload(), reqs());
    assert.equal(c.size, 1);
  });
});

describe("a payer-authored schema proves nothing on its own", () => {
  // extractDiscoveryInfo checks `info` against the `schema` shipped beside it,
  // and the payer writes both. Protocol invariants have to be enforced too.
  const permissive = (input: Record<string, unknown>) => ({
    bazaar: { info: { input, output: { type: "json" } }, schema: { type: "object" } },
  });

  test("input.type outside http/mcp is rejected", () => {
    const c = openCatalog();
    c.record(payload({ extensions: permissive({ type: "nonsense" }) }), reqs());
    assert.equal(c.size, 0);
  });

  test("an invented HTTP method is rejected", () => {
    const c = openCatalog();
    c.record(payload({ extensions: permissive({ type: "http", method: "BREAKIN" }) }), reqs());
    assert.equal(c.size, 0);
  });

  test("an MCP declaration without toolName is rejected", () => {
    const c = openCatalog();
    c.record(
      payload({ extensions: permissive({ type: "mcp", inputSchema: { type: "object" } }) }),
      reqs()
    );
    assert.equal(c.size, 0);
  });

  test("a value the validator cannot even format does not escape record()", () => {
    // validateDiscoveryExtensionSpec throws a TypeError on this. Escaping would
    // turn a settled on-chain payment into a 500 for the payer.
    const c = openCatalog();
    assert.doesNotThrow(() =>
      c.record(payload({ extensions: permissive({ type: { toString: 1 } }) }), reqs())
    );
    assert.equal(c.size, 0);
  });
});

describe("only resources a client could actually call get listed", () => {
  test("an HTTP declaration with no method is not indexed", () => {
    const c = openCatalog();
    c.record(payload({ extensions: httpDeclaration({ type: "http" }) }), reqs());
    assert.equal(c.size, 0);
  });

  for (const method of ["GET", "HEAD", "DELETE"]) {
    test(`${method} needs nothing beyond the method`, () => {
      const c = openCatalog();
      c.record(payload({ extensions: httpDeclaration({ type: "http", method }) }), reqs());
      assert.equal(c.size, 1);
    });
  }

  for (const method of ["POST", "PUT", "PATCH"]) {
    test(`${method} without bodyType is rejected — the client cannot build a body`, () => {
      const c = openCatalog();
      c.record(payload({ extensions: httpDeclaration({ type: "http", method }) }), reqs());
      assert.equal(c.size, 0);
    });

    test(`${method} with a valid bodyType is indexed`, () => {
      const c = openCatalog();
      c.record(
        payload({ extensions: httpDeclaration({ type: "http", method, bodyType: "json" }) }),
        reqs()
      );
      assert.equal(c.size, 1);
    });
  }

  test("an MCP tool needs no HTTP method", () => {
    const c = openCatalog();
    c.record(payload({ extensions: mcpDeclaration() }), reqs());
    assert.equal(c.size, 1);
    assert.equal(c.query({}).items[0]!.type, "mcp");
  });
});

describe("published terms are the ones that settled", () => {
  test("accepts comes from the validated requirements, not payload.accepted", () => {
    // Regression: settle() validates the `requirements` argument; `accepted` is
    // a separate, caller-controlled copy. Publishing the latter would advertise
    // terms nobody ever settled.
    const c = openCatalog("REAL");
    c.record(
      payload({ accepted: reqs({ payTo: "ATTACKER", amount: "999999999", asset: "FAKE" }) }),
      reqs({ payTo: "REAL", amount: "1000", asset: "USDC" })
    );
    const a = c.query({}).items[0]!.accepts[0]!;
    assert.deepEqual([a.payTo, a.amount, a.asset], ["REAL", "1000", "USDC"]);
    assert.equal(c.query({ payTo: "ATTACKER" }).pagination.total, 0);
  });

  test("an object shaped like PaymentRequirements carries no discovery metadata", () => {
    // Regression: the first implementation read `resource` off the requirements,
    // where the type has no such field, so the index could never have filled.
    const c = openCatalog();
    c.record(reqs({ resource: "https://x.example/y" } as Partial<PaymentRequirements>) as unknown as PaymentPayload, reqs());
    assert.equal(c.size, 0);
  });

  test("missing arguments are ignored", () => {
    const c = openCatalog();
    c.record(undefined, reqs());
    c.record(payload(), undefined);
    c.record(undefined, undefined);
    assert.equal(c.size, 0);
  });
});

describe("requirements are checked by runtime type and size", () => {
  // Nothing upstream does this: the object arrives from JSON, settle() applies
  // no schema, and the SVM scheme reads only the fields it needs.
  const bad: [string, unknown][] = [
    ["maxTimeoutSeconds", "Z".repeat(100_000)],
    ["maxTimeoutSeconds", { a: 1 }],
    ["maxTimeoutSeconds", -1],
    ["maxTimeoutSeconds", 0],
    ["maxTimeoutSeconds", 1.5],
    ["maxTimeoutSeconds", 999_999_999],
    ["scheme", "S".repeat(1000)],
    ["network", 12345],
    ["asset", { obj: true }],
    ["payTo", ""],
    ["amount", "not-a-number"],
    ["amount", "1".repeat(100)],
  ];

  for (const [field, value] of bad) {
    test(`rejects ${field}=${JSON.stringify(value)?.slice(0, 24)}`, () => {
      const c = openCatalog();
      c.record(payload(), reqs({ [field]: value } as Partial<PaymentRequirements>));
      assert.equal(c.size, 0);
    });
  }

  test("a well-formed set is accepted", () => {
    const c = openCatalog();
    c.record(payload(), reqs({ maxTimeoutSeconds: 60 }));
    assert.equal(c.size, 1);
  });

  test("extra survives when small — clients need feePayer to build a payment", () => {
    const c = openCatalog();
    c.record(payload(), reqs({ extra: { feePayer: "ETpEE1qs", name: "USDC" } }));
    assert.deepEqual(c.query({}).items[0]!.accepts[0]!.extra, {
      feePayer: "ETpEE1qs",
      name: "USDC",
    });
  });

  test("an oversized extra drops the whole record rather than emptying it", () => {
    // Emptying it would strip extra.feePayer, advertising an option that
    // ExactSvmScheme refuses to settle.
    const c = openCatalog();
    c.record(payload(), reqs({ extra: { pad: "z".repeat(50_000) } }));
    assert.equal(c.size, 0);
  });

  test("accepts carries only the published fields", () => {
    const c = openCatalog();
    c.record(payload(), reqs());
    assert.deepEqual(Object.keys(c.query({}).items[0]!.accepts[0]!).sort(), [
      "amount",
      "asset",
      "extra",
      "maxTimeoutSeconds",
      "network",
      "payTo",
      "scheme",
    ]);
  });
});

describe("the operator decides what may be published", () => {
  test("with nothing declared the index publishes nothing", () => {
    // Settling authenticates the transfer, never the metadata riding with it,
    // so the default has to be closed.
    const c = new ResourceCatalog();
    c.record(payload(), reqs());
    assert.equal(c.size, 0);
    assert.equal(c.query({}).pagination.total, 0);
    assert.equal(c.query({}).x402Version, 2);
  });

  test("a declared origin paid to the declared payee is published", () => {
    const c = new ResourceCatalog([["https://api.example.com", PAYEE]]);
    c.record(payload(), reqs());
    assert.equal(c.size, 1);
  });

  test("a declared origin paid to somebody else is not — this is payment redirection", () => {
    const c = new ResourceCatalog([["https://api.example.com", "OWNER"]]);
    c.record(payload(), reqs({ payTo: "ATTACKER" }));
    assert.equal(c.size, 0);
  });

  test("the declared payee cannot attach a foreign origin", () => {
    const c = new ResourceCatalog([["https://api.example.com", PAYEE]]);
    c.record(payload({ url: "https://elsewhere.example/x" }), reqs());
    assert.equal(c.size, 0);
  });

  test("origins match on parsed origin, not string prefix", () => {
    const c = new ResourceCatalog([["https://api.example.com", PAYEE]]);
    c.record(payload({ url: "https://api.example.com.evil.test/x" }), reqs());
    c.record(payload({ url: "http://api.example.com/data" }), reqs());
    assert.equal(c.size, 0);
  });

  test('"*" is an explicit opt-in, still bound to its payee', () => {
    const c = openCatalog();
    c.record(payload({ url: "https://anything.example/x" }), reqs());
    assert.equal(c.size, 1);
    c.record(payload({ url: "https://other.example/y" }), reqs({ payTo: "SOMEONE-ELSE" }));
    assert.equal(c.size, 1);
  });
});

describe("resource URLs", () => {
  const rejected = [
    "not-a-url",
    "ftp://x.example/a",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://x.example/" + "a".repeat(3000),
  ];

  for (const url of rejected) {
    test(`rejects ${url.slice(0, 34)}`, () => {
      const c = openCatalog();
      c.record(payload({ url }), reqs());
      assert.equal(c.size, 0);
    });
  }

  test("a payload with no resource at all is ignored", () => {
    const c = openCatalog();
    c.record(payload({ resource: null }), reqs());
    assert.equal(c.size, 0);
  });

  test("fragment and credentials are stripped so spellings collapse to one entry", () => {
    const c = openCatalog();
    c.record(payload({ url: "https://api.example.com/data" }), reqs());
    c.record(payload({ url: "https://api.example.com/data#section" }), reqs());
    c.record(payload({ url: "https://user:pw@api.example.com/data" }), reqs());
    assert.equal(c.size, 1);
    const { resource } = c.query({}).items[0]!;
    assert.ok(!resource.includes("pw") && !resource.includes("#"), resource);
  });
});

describe("service metadata is sanitized by the SDK's own rules", () => {
  test("valid metadata is kept", () => {
    const c = openCatalog();
    c.record(
      payload({
        resource: {
          serviceName: "Weather API",
          tags: ["weather", "api"],
          iconUrl: "https://api.example.com/icon.png",
          description: "Weather data",
          mimeType: "application/json",
        },
      }),
      reqs()
    );
    const i = c.query({}).items[0]!;
    assert.equal(i.serviceName, "Weather API");
    assert.deepEqual(i.tags, ["weather", "api"]);
    assert.equal(i.mimeType, "application/json");
  });

  test("a hostile iconUrl is dropped and tags are capped", () => {
    const c = openCatalog();
    c.record(
      payload({
        resource: {
          iconUrl: "javascript:alert(1)",
          tags: Array.from({ length: 40 }, (_, n) => `t${n}`),
          description: "D".repeat(5000),
        },
      }),
      reqs()
    );
    const i = c.query({}).items[0]!;
    assert.equal(i.iconUrl, undefined);
    assert.ok((i.tags?.length ?? 0) <= 5);
    assert.ok((i.description?.length ?? 0) <= 512);
  });

  test("a non-ASCII serviceName is dropped — an SDK rule, not our bug", () => {
    // Recorded so it does not later read as a defect on our side.
    const c = openCatalog();
    c.record(payload({ resource: { serviceName: "Moja Usługa" } }), reqs());
    assert.equal(c.query({}).items[0]!.serviceName, undefined);
  });
});

describe("extension echo", () => {
  test("every key is kept, so ?extensions=<key> can match more than bazaar", () => {
    const c = openCatalog();
    c.record(
      payload({ extensions: { ...httpDeclaration(), "sign-in-with-x": { info: { v: 1 } } } }),
      reqs()
    );
    assert.deepEqual(Object.keys(c.query({}).items[0]!.extensions ?? {}).sort(), [
      "bazaar",
      "sign-in-with-x",
    ]);
    assert.equal(c.query({ extensions: "sign-in-with-x" }).pagination.total, 1);
  });

  test("an oversized foreign key is shed but the resource stays listed", () => {
    const c = openCatalog();
    c.record(
      payload({ extensions: { ...httpDeclaration(), bulk: { pad: "x".repeat(100_000) } } }),
      reqs()
    );
    assert.deepEqual(Object.keys(c.query({}).items[0]!.extensions ?? {}), ["bazaar"]);
  });

  test("an oversized declaration drops the record — the entry would be uncallable", () => {
    const decl = httpDeclaration();
    (decl.bazaar as Record<string, unknown>).pad = "y".repeat(20_000);
    const c = openCatalog();
    c.record(payload({ extensions: decl }), reqs());
    assert.equal(c.size, 0);
  });
});

describe("payment options", () => {
  test("identical terms do not duplicate", () => {
    const c = openCatalog();
    c.record(payload(), reqs());
    c.record(payload(), reqs());
    assert.equal(c.query({}).items[0]!.accepts.length, 1);
  });

  test("a price change replaces the old price instead of listing both", () => {
    // A client taking the first match would otherwise pay a stale price the
    // resource server rejects.
    const c = openCatalog();
    c.record(payload(), reqs({ amount: "1000" }));
    c.record(payload(), reqs({ amount: "5000" }));
    const accepts = c.query({}).items[0]!.accepts;
    assert.equal(accepts.length, 1);
    assert.equal(accepts[0]!.amount, "5000");
  });

  test("a genuinely different way to pay is a separate option", () => {
    const c = openCatalog();
    c.record(payload(), reqs());
    c.record(payload(), reqs({ network: "solana:other" as PaymentRequirements["network"] }));
    assert.equal(c.query({}).items[0]!.accepts.length, 2);
  });

  test("varying the amount cannot inflate the list", () => {
    const c = openCatalog();
    for (let i = 0; i < 50; i++) c.record(payload(), reqs({ amount: String(i + 1) }));
    assert.equal(c.query({}).items[0]!.accepts.length, 1);
  });
});

describe("filtering and pagination", () => {
  const seeded = () => {
    const c = openCatalog();
    c.record(payload({ url: "https://a.example/1" }), reqs({ payTo: PAYEE, scheme: "exact" }));
    c.record(
      payload({ url: "https://b.example/2", extensions: mcpDeclaration() }),
      reqs({ payTo: PAYEE, scheme: "upto" })
    );
    return c;
  };

  test("filters by payTo, scheme, network and type", () => {
    const c = seeded();
    assert.equal(c.query({ scheme: "upto" }).items[0]!.resource, "https://b.example/2");
    assert.equal(c.query({ type: "mcp" }).items[0]!.resource, "https://b.example/2");
    assert.equal(c.query({ type: "http" }).items[0]!.resource, "https://a.example/1");
    assert.equal(c.query({ payTo: PAYEE }).pagination.total, 2);
    assert.equal(c.query({ payTo: "NOBODY" }).pagination.total, 0);
    assert.equal(c.query({ network: NETWORK }).pagination.total, 2);
  });

  test("an unknown extension key matches nothing", () => {
    assert.equal(seeded().query({ extensions: "nope" }).pagination.total, 0);
  });

  const paged = () => {
    const c = openCatalog();
    for (let i = 0; i < 30; i++) c.record(payload({ url: `https://x.example/${i}` }), reqs());
    return c;
  };

  test("limit defaults to 20 and is clamped to 1..100", () => {
    const c = paged();
    assert.equal(c.query({}).items.length, 20);
    assert.equal(c.query({ limit: "5" }).items.length, 5);
    assert.equal(c.query({ limit: "999" }).items.length, 30);
    assert.equal(c.query({ limit: "0" }).items.length, 1);
    assert.equal(c.query({ limit: "-7" }).items.length, 1);
    assert.equal(c.query({ limit: "abc" }).items.length, 20);
  });

  test("offset pages through and total counts every match", () => {
    const c = paged();
    assert.equal(c.query({ limit: "10", offset: "25" }).items.length, 5);
    assert.equal(c.query({ offset: "999" }).items.length, 0);
    assert.equal(c.query({ limit: "10" }).pagination.total, 30);
  });
});

describe("the index is bounded", () => {
  test("it holds 1000 entries and evicts the least recently updated", () => {
    const c = openCatalog();
    for (let i = 0; i < 1200; i++) c.record(payload({ url: `https://spam.example/${i}` }), reqs());
    assert.equal(c.size, 1000);
    // Assert the exact surviving window. Checking that one page does *not*
    // contain the oldest entry proves nothing: listing is newest-first, so an
    // un-evicted entry 0 would sit past the page anyway.
    assert.equal(c.query({ limit: "1" }).items[0]?.resource, "https://spam.example/1199", "newest kept");
    assert.equal(
      c.query({ limit: "1", offset: "999" }).items[0]?.resource,
      "https://spam.example/200",
      "the 200 oldest were evicted, leaving exactly 200..1199"
    );
  });

  test("ordering is newest-first and survives same-millisecond writes", () => {
    // Sorting on lastUpdated collapsed here: the field is a timestamp and ties
    // are common, so insertion order is used instead.
    const c = openCatalog();
    for (let i = 0; i < 5; i++) c.record(payload({ url: `https://o.example/${i}` }), reqs());
    assert.deepEqual(
      c.query({}).items.map((i) => i.resource),
      [4, 3, 2, 1, 0].map((i) => `https://o.example/${i}`)
    );
  });
});
