/**
 * Tests for graceful shutdown.
 *
 * Heroku sends SIGTERM on every dyno cycle and SIGKILLs 30s later. Production
 * hit `Error R12 (Exit timeout)` once because nothing handled the signal, and a
 * kill mid-request is worst for /settle: the transaction may already be on
 * chain while the payer's connection dies, so they see a failure for money that
 * moved.
 *
 * These spawn the built facilitator, so `pnpm build` has to have run.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

/** Ephemeral signer so the test never touches a real wallet. */
function keypairBytes(): string {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const priv = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return JSON.stringify(Array.from(Buffer.concat([priv, pub])));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start(port: number): Promise<ChildProcess> {
  const proc = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      FACILITATOR_PORT: String(port),
      FACILITATOR_KEYPAIR_BYTES: keypairBytes(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 100; i++) {
    const up = await new Promise<boolean>((res) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/" }, (r) => {
        r.resume();
        res(true);
      });
      req.on("error", () => res(false));
    });
    if (up) return proc;
    await sleep(150);
  }
  throw new Error("facilitator did not come up");
}

/** SIGTERM, then how long it took to exit. */
async function terminate(proc: ChildProcess): Promise<number> {
  const started = Date.now();
  proc.kill("SIGTERM");
  await new Promise<void>((res, rej) => {
    const timer = setTimeout(() => rej(new Error("did not exit within 30s — this is the R12 case")), 30_000);
    proc.on("exit", () => {
      clearTimeout(timer);
      res();
    });
  });
  return Date.now() - started;
}

describe("graceful shutdown", () => {
  let port = 4900;
  const spawned: ChildProcess[] = [];
  after(() => {
    // `killed` only means a signal was sent, so it is already true for every
    // process terminate() touched — including one that ignored SIGTERM, which
    // is the regression this suite exists to catch. Checking it here would skip
    // the SIGKILL and leave that process running, hanging CI instead of
    // reporting the failure. A live process has both codes still null.
    for (const p of spawned) {
      if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
    }
  });

  test("exits promptly when idle", async () => {
    const proc = await start(port++);
    spawned.push(proc);
    const ms = await terminate(proc);
    assert.ok(ms < 5000, `expected a prompt exit, took ${ms}ms`);
  });

  test("an idle keep-alive socket does not hold the process open", async () => {
    // server.close() waits on every open socket, and the uptime monitor polling
    // /supported parks one for minutes. This was the shape of the R12.
    const p = port++;
    const proc = await start(p);
    spawned.push(proc);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    await new Promise<void>((res, rej) => {
      const req = http.get({ host: "127.0.0.1", port: p, path: "/supported", agent }, (r) => {
        r.resume();
        r.on("end", () => res());
      });
      req.on("error", rej);
    });
    await sleep(300);
    const ms = await terminate(proc);
    agent.destroy();
    assert.ok(ms < 5000, `idle keep-alive delayed exit by ${ms}ms`);
  });

  test("a request still streaming when SIGTERM lands is answered, not severed", async () => {
    // The body has to stay *under* express.json's 256 KB limit until the signal
    // is sent. Writing past it up front lets the parser answer 413 before
    // shutdown even starts, and the test would then pass on a server that
    // severs in-flight work — which is exactly the regression it is here for.
    const p = port++;
    const proc = await start(p);
    spawned.push(proc);

    let status: number | undefined;
    let socketError: string | undefined;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: p,
        path: "/verify",
        method: "POST",
        // Chunked, so the server cannot know the size in advance and has to
        // keep reading past the signal.
        headers: { "content-type": "application/json" },
      },
      (res) => {
        status = res.statusCode;
        res.resume();
      }
    );
    req.on("error", (e: NodeJS.ErrnoException) => {
      socketError = e.code ?? e.message;
    });

    req.write('{"a":"' + "x".repeat(100_000));
    await sleep(200);

    // Guards the guard: if this ever fires, the body limit was hit early and
    // the rest of the test would be asserting nothing about shutdown.
    assert.equal(status, undefined, "request was answered before SIGTERM — test is not testing shutdown");

    const exited = terminate(proc);
    await sleep(100);
    // Only now push it over the limit and finish the body.
    req.end("x".repeat(200_000) + '"}');
    await exited;
    await sleep(300);

    assert.equal(
      socketError,
      undefined,
      `connection was severed instead of drained (${socketError})`
    );
    assert.equal(status, 413, "the request should have been answered while draining");
  });
});
