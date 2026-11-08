import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

async function withRunningServer(callback) {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("healthz reports ok", async () => {
  await withRunningServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

test("index page is served with security headers", async () => {
  await withRunningServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.ok(response.headers.get("content-security-policy").includes("default-src 'self'"));
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    const body = await response.text();
    assert.ok(body.includes("Deep Sea Facts"));
  });
});

test("path traversal outside the public directory is rejected", async () => {
  await withRunningServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/..%2Fserver.js`);
    assert.ok([400, 404].includes(response.status));
  });
});

test("chat without a configured inference endpoint degrades gracefully", async () => {
  await withRunningServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Why do anglerfish glow?" }),
    });
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.match(payload.error, /Sonar is resting/);
  });
});

test("chat rejects malformed and oversized messages", async () => {
  await withRunningServer(async (baseUrl) => {
    const emptyResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    assert.equal(emptyResponse.status, 400);

    const oversizedResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "a".repeat(600) }),
    });
    assert.equal(oversizedResponse.status, 400);
  });
});

test("unknown routes return 404 and unsupported methods return 405", async () => {
  await withRunningServer(async (baseUrl) => {
    const notFoundResponse = await fetch(`${baseUrl}/no-such-page.html`);
    assert.equal(notFoundResponse.status, 404);

    const methodResponse = await fetch(`${baseUrl}/healthz`, { method: "DELETE" });
    assert.equal(methodResponse.status, 405);
  });
});

async function withServer(server, callback) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function askSonar(baseUrl) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Why do anglerfish glow?" }),
  });
  return { status: response.status, payload: await response.json() };
}

test("chat says the model is unreachable when the upstream refuses the connection", async () => {
  const closedServer = http.createServer();
  await new Promise((resolve) => closedServer.listen(0, "127.0.0.1", resolve));
  const { port: closedPort } = closedServer.address();
  await new Promise((resolve) => closedServer.close(resolve));

  const app = createApp({
    inferenceBaseUrl: `http://127.0.0.1:${closedPort}/v1`,
    inferenceApiKey: "test-key",
  });
  await withServer(app, async (baseUrl) => {
    assert.deepEqual(await askSonar(baseUrl), {
      status: 502,
      payload: { error: "Sonar can't reach its model right now. Try again later." },
    });
  });
});

test("chat says the model took too long only when the upstream actually times out", async () => {
  const stalledUpstream = http.createServer(() => {});
  await withServer(stalledUpstream, async (upstreamUrl) => {
    const app = createApp({
      inferenceBaseUrl: `${upstreamUrl}/v1`,
      inferenceApiKey: "test-key",
      upstreamTimeoutMilliseconds: 50,
    });
    await withServer(app, async (baseUrl) => {
      assert.deepEqual(await askSonar(baseUrl), {
        status: 504,
        payload: { error: "The inference server took too long to answer." },
      });
    });
  });
});
