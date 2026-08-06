/**
 * Tests for the spend caps.
 *
 * This is the only thing standing between a misbehaving or manipulated agent
 * and an unbounded run of payments, so the interesting assertions are the ones
 * about refusal.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createSpendCapEnforcer } from "../src/index.js";

const amounts = (reqs: { amount: string }[]) => reqs.map((r) => r.amount);
const req = (amount: string) => ({ amount });

describe("no caps configured", () => {
  test("returns null so nothing is registered and spending is unrestricted", () => {
    assert.equal(createSpendCapEnforcer({}), null);
    assert.equal(createSpendCapEnforcer({ maxPaymentPerCall: undefined }), null);
  });
});

describe("per-call cap", () => {
  test("filters out requirements above the cap and keeps the rest", () => {
    const caps = createSpendCapEnforcer({ maxPaymentPerCall: "1000" })!;
    assert.deepEqual(
      amounts(caps.policy([req("500"), req("1000"), req("1001"), req("999999")])),
      ["500", "1000"]
    );
  });

  test("the boundary is inclusive — exactly the cap is allowed", () => {
    const caps = createSpendCapEnforcer({ maxPaymentPerCall: "1000" })!;
    assert.deepEqual(amounts(caps.policy([req("1000")])), ["1000"]);
  });

  test("filtering everything out leaves the caller with no way to pay", () => {
    // The wrapped fetch then rejects, surfacing an error on the tool call
    // rather than silently overspending.
    const caps = createSpendCapEnforcer({ maxPaymentPerCall: "100" })!;
    assert.deepEqual(caps.policy([req("101"), req("500")]), []);
  });

  test("a per-call cap alone registers no session accounting", () => {
    const caps = createSpendCapEnforcer({ maxPaymentPerCall: "1000" })!;
    assert.equal(caps.hasSessionBudget, false);
  });

  test("amounts far beyond Number.MAX_SAFE_INTEGER are still compared correctly", () => {
    // Base units are decimal strings and get parsed as BigInt; doing this in
    // floating point would silently pass an over-cap payment.
    const caps = createSpendCapEnforcer({ maxPaymentPerCall: "9007199254740993" })!;
    assert.deepEqual(amounts(caps.policy([req("9007199254740994")])), []);
    assert.deepEqual(amounts(caps.policy([req("9007199254740993")])), ["9007199254740993"]);
  });
});

describe("session budget", () => {
  test("accepts payments until the budget is exhausted, then refuses", async () => {
    const caps = createSpendCapEnforcer({ sessionBudget: "2500" })!;
    const spend = (amount: string) => caps.beforePaymentCreation({ selectedRequirements: req(amount) });

    assert.equal(await spend("1000"), undefined, "first payment accepted");
    assert.equal(await spend("1000"), undefined, "second payment accepted");

    const refused = await spend("1000");
    assert.equal(refused?.abort, true, "third payment must be refused");
    assert.match(refused!.reason, /session budget exceeded/);

    assert.equal(await spend("500"), undefined, "a payment that still fits is accepted");
    assert.equal(caps.spent(), 2500n, "total never exceeds the budget");
  });

  test("a refused payment does not consume budget", async () => {
    const caps = createSpendCapEnforcer({ sessionBudget: "1000" })!;
    await caps.beforePaymentCreation({ selectedRequirements: req("1001") });
    assert.equal(caps.spent(), 0n);
    assert.equal(await caps.beforePaymentCreation({ selectedRequirements: req("1000") }), undefined);
    assert.equal(caps.spent(), 1000n);
  });

  test("reserving is atomic, so concurrent calls cannot both slip through", async () => {
    // The policy filter is advisory: several tool calls can pass it before any
    // payment finishes. This check-and-reserve is the real enforcement.
    const caps = createSpendCapEnforcer({ sessionBudget: "1000" })!;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        caps.beforePaymentCreation({ selectedRequirements: req("1000") })
      )
    );
    assert.equal(results.filter((r) => r === undefined).length, 1, "exactly one may proceed");
    assert.equal(caps.spent(), 1000n);
  });

  test("the policy filter also narrows as the budget is consumed", async () => {
    const caps = createSpendCapEnforcer({ sessionBudget: "1000" })!;
    assert.deepEqual(amounts(caps.policy([req("800")])), ["800"]);
    await caps.beforePaymentCreation({ selectedRequirements: req("800") });
    assert.deepEqual(caps.policy([req("800")]), [], "no longer affordable once reserved");
    assert.deepEqual(amounts(caps.policy([req("200")])), ["200"]);
  });
});

describe("both caps together", () => {
  test("a payment must satisfy the per-call cap and the remaining budget", async () => {
    const caps = createSpendCapEnforcer({ maxPaymentPerCall: "600", sessionBudget: "1000" })!;
    assert.deepEqual(amounts(caps.policy([req("500"), req("700")])), ["500"], "700 is over the per-call cap");
    await caps.beforePaymentCreation({ selectedRequirements: req("500") });
    assert.deepEqual(amounts(caps.policy([req("500"), req("600")])), ["500"], "600 no longer fits the budget");
    assert.equal(caps.spent(), 500n);
  });

  test("a zero budget refuses everything", async () => {
    const caps = createSpendCapEnforcer({ sessionBudget: "0" })!;
    assert.deepEqual(caps.policy([req("1")]), []);
    const r = await caps.beforePaymentCreation({ selectedRequirements: req("1") });
    assert.equal(r?.abort, true);
  });
});
