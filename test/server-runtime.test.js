import assert from "node:assert/strict";
import express from "express";
import test from "node:test";

async function loadServerRuntime() {
  return import("../src/server-runtime.js").catch(() => ({}));
}

test("startHttpServer uses an available port and can be stopped", async () => {
  const { startHttpServer } = await loadServerRuntime();
  assert.equal(typeof startHttpServer, "function", "server runtime is not implemented");

  const app = express();
  app.get("/health", (_req, res) => res.json({ ok: true }));
  const runtime = await startHttpServer({ app, host: "127.0.0.1", port: 0 });

  try {
    assert.match(runtime.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${runtime.url}/health`);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await runtime.close();
  }

  assert.equal(runtime.server.listening, false);
});
