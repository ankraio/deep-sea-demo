import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const publicDirectory = fileURLToPath(new URL("./public", import.meta.url));
const port = Number.parseInt(process.env.PORT ?? "8080", 10);

const inferenceBaseUrl = process.env.OPENAI_BASE_URL ?? "";
const inferenceApiKey = process.env.OPENAI_API_KEY ?? "";
const inferenceModel = process.env.MODEL_NAME ?? "qwen3-8b";

const maxRequestBodyBytes = 4096;
const maxMessageLength = 500;
const maxHistoryMessages = 6;
const upstreamTimeoutMilliseconds = 30_000;

const chatRequestsPerMinute = 10;
const requestCountsByAddress = new Map();

const contentTypesByExtension = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const sonarSystemPrompt = [
  "You are Sonar, a cheerful deep sea guide who answers questions about the",
  "ocean, its creatures, its physics, and its exploration. Keep answers to a",
  "few sentences, stay factual, and admit when something is unknown to",
  "science. Politely steer unrelated questions back to the deep sea.",
].join(" ");

function isRateLimited(remoteAddress) {
  const currentMinute = Math.floor(Date.now() / 60_000);
  const entry = requestCountsByAddress.get(remoteAddress);
  if (entry === undefined || entry.minute !== currentMinute) {
    requestCountsByAddress.set(remoteAddress, { minute: currentMinute, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > chatRequestsPerMinute;
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    ...securityHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readRequestBody(request) {
  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    receivedBytes += chunk.length;
    if (receivedBytes > maxRequestBodyBytes) {
      throw new Error("request body too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseChatRequest(rawBody) {
  const parsed = JSON.parse(rawBody);
  const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
  if (message.length === 0 || message.length > maxMessageLength) {
    return null;
  }
  const history = Array.isArray(parsed.history)
    ? parsed.history
        .filter(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            (entry.role === "user" || entry.role === "assistant") &&
            typeof entry.content === "string" &&
            entry.content.length <= maxMessageLength,
        )
        .slice(-maxHistoryMessages)
    : [];
  return { message, history };
}

async function handleChatRequest(request, response) {
  if (isRateLimited(request.socket.remoteAddress ?? "unknown")) {
    sendJson(response, 429, { error: "Sonar needs a short breather. Try again in a minute." });
    return;
  }

  let chatRequest;
  try {
    chatRequest = parseChatRequest(await readRequestBody(request));
  } catch {
    chatRequest = null;
  }
  if (chatRequest === null) {
    sendJson(response, 400, { error: "Send a JSON body with a short 'message' string." });
    return;
  }

  if (inferenceBaseUrl === "" || inferenceApiKey === "") {
    sendJson(response, 503, {
      error: "Sonar is resting in the abyss: no inference endpoint is configured.",
    });
    return;
  }

  try {
    const upstreamResponse = await fetch(`${inferenceBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${inferenceApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: inferenceModel,
        messages: [
          { role: "system", content: sonarSystemPrompt },
          ...chatRequest.history,
          { role: "user", content: chatRequest.message },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(upstreamTimeoutMilliseconds),
    });

    if (!upstreamResponse.ok) {
      sendJson(response, 502, { error: "The inference server declined that request." });
      return;
    }

    const completion = await upstreamResponse.json();
    const reply = completion.choices?.[0]?.message?.content?.trim() ?? "";
    if (reply === "") {
      sendJson(response, 502, { error: "The inference server sent an empty reply." });
      return;
    }
    sendJson(response, 200, { reply });
  } catch {
    sendJson(response, 504, { error: "The inference server took too long to answer." });
  }
}

async function handleStaticRequest(request, response) {
  const requestPath = request.url === "/" ? "/index.html" : (request.url ?? "/");
  const safePath = normalize(requestPath).replaceAll("\\", "/");
  if (safePath.includes("..")) {
    sendJson(response, 400, { error: "invalid path" });
    return;
  }

  const contentType = contentTypesByExtension[extname(safePath)];
  if (contentType === undefined) {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  try {
    const fileContents = await readFile(join(publicDirectory, safePath));
    response.writeHead(200, {
      ...securityHeaders,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300",
      "Content-Length": fileContents.length,
    });
    response.end(fileContents);
  } catch {
    sendJson(response, 404, { error: "not found" });
  }
}

export function createApp() {
  return http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "POST" && request.url === "/api/chat") {
      await handleChatRequest(request, response);
      return;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      await handleStaticRequest(request, response);
      return;
    }
    sendJson(response, 405, { error: "method not allowed" });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(port, () => {
    console.log(`Deep Sea Facts listening on port ${port}`);
  });
}
