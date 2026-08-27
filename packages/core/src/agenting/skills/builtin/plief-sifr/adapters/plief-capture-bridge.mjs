#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = arg(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    process.stderr.write(`[Pli'ef Capture] invalid ${name}: ${raw}\n`);
    process.exit(2);
  }
  return value;
}

const HOST = "127.0.0.1";
const PORT = intArg("--port", 17321, { min: 1, max: 65535 });
const INBOX = path.resolve(arg("--dir", ".plief/captures/inbox"));
const MAX_BYTES = intArg("--max-bytes", 5 * 1024 * 1024, { min: 1024 });
const EXTENSION_ID = arg("--extension-id", null);

fs.mkdirSync(INBOX, { recursive: true });

function safeSlug(value) {
  return String(value || "component")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "component";
}

function validOrigin(origin) {
  // Origin-less requests preserve local CLI/manual tooling.
  if (!origin) return true;

  // Browser sandbox/file origins should not get localhost write access.
  if (origin === "null") return false;

  const match = /^chrome-extension:\/\/([a-z]{32})$/.exec(origin);
  if (!match) return false;

  return !EXTENSION_ID || match[1] === EXTENSION_ID;
}

function responseHeaders(origin = null) {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin && validOrigin(origin) ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  };
}

function send(res, status, body, origin = null) {
  if (res.writableEnded) return;
  const json = JSON.stringify(body);
  res.writeHead(status, {
    ...responseHeaders(origin),
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function validateCapsule(capsule) {
  if (!capsule || typeof capsule !== "object" || Array.isArray(capsule)) {
    return "invalid-capsule";
  }
  if (capsule.schema !== "plief-capsule/v1") {
    return "invalid-schema";
  }
  if (capsule.component != null && (typeof capsule.component !== "object" || Array.isArray(capsule.component))) {
    return "invalid-component";
  }
  if (capsule.preview != null && (typeof capsule.preview !== "object" || Array.isArray(capsule.preview))) {
    return "invalid-preview";
  }
  if (capsule.registry != null && (typeof capsule.registry !== "object" || Array.isArray(capsule.registry))) {
    return "invalid-registry";
  }
  return null;
}

async function atomicWrite(target, text) {
  const dir = path.dirname(target);
  const base = path.basename(target);
  const tmp = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  await fs.promises.writeFile(tmp, text, { encoding: "utf8", mode: 0o600 });
  await fs.promises.rename(tmp, target);
}

// Serialize latest.json updates so concurrent requests cannot reorder partial writes.
let writeChain = Promise.resolve();
function enqueueCapsuleWrite(capsule) {
  const slug = safeSlug(capsule?.component?.slug || capsule?.component?.name);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${stamp}-${slug}.json`;
  const target = path.join(INBOX, filename);
  const latest = path.join(INBOX, "latest.json");
  const body = JSON.stringify(capsule, null, 2) + "\n";

  const task = async () => {
    await atomicWrite(target, body);
    await atomicWrite(latest, body);
    return { slug, target };
  };

  writeChain = writeChain.then(task, task);
  return writeChain;
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || null;

  if (req.method === "OPTIONS") {
    if (!validOrigin(origin)) {
      return send(res, 403, { ok: false, error: "origin-denied" });
    }
    res.writeHead(204, {
      ...responseHeaders(origin),
      "content-length": "0",
    });
    return res.end();
  }

  if (req.method !== "POST" || req.url !== "/plief/ingest") {
    return send(res, 404, { ok: false, error: "not-found" }, origin);
  }

  if (!validOrigin(origin)) {
    return send(res, 403, { ok: false, error: "origin-denied" });
  }

  const declaredLength = Number(req.headers["content-length"] || 0);
  if (declaredLength > MAX_BYTES) {
    req.resume();
    return send(res, 413, { ok: false, error: "payload-too-large", maxBytes: MAX_BYTES }, origin);
  }

  let bytes = 0;
  let tooLarge = false;
  const chunks = [];

  req.on("data", (chunk) => {
    if (tooLarge) return;

    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      send(res, 413, { ok: false, error: "payload-too-large", maxBytes: MAX_BYTES }, origin);
      return;
    }

    chunks.push(chunk);
  });

  req.on("end", async () => {
    if (tooLarge || res.writableEnded) return;

    let capsule;
    try {
      capsule = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(res, 400, { ok: false, error: "invalid-json" }, origin);
    }

    const capsuleError = validateCapsule(capsule);
    if (capsuleError) {
      return send(res, 400, { ok: false, error: capsuleError }, origin);
    }

    try {
      const { slug, target } = await enqueueCapsuleWrite(capsule);
      send(
        res,
        200,
        { ok: true, stored: path.relative(process.cwd(), target) },
        origin,
      );
      process.stdout.write(`[Pli'ef Capture] received ${slug} -> ${target}\n`);
    } catch (error) {
      process.stderr.write(`[Pli'ef Capture] write failed: ${error?.stack || error}\n`);
      send(res, 500, { ok: false, error: "write-failed" }, origin);
    }
  });

  req.on("error", (error) => {
    process.stderr.write(`[Pli'ef Capture] request error: ${error?.message || error}\n`);
  });
});

server.on("clientError", (error, socket) => {
  process.stderr.write(`[Pli'ef Capture] client error: ${error?.message || error}\n`);
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

function shutdown(signal) {
  process.stdout.write(`[Pli'ef Capture] ${signal}; shutting down\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 1500).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

server.listen(PORT, HOST, () => {
  process.stdout.write(`[Pli'ef Capture] bridge listening on http://${HOST}:${PORT}/plief/ingest\n`);
  process.stdout.write(`[Pli'ef Capture] inbox: ${INBOX}\n`);
  process.stdout.write(`[Pli'ef Capture] max payload: ${MAX_BYTES} bytes\n`);
  if (EXTENSION_ID) {
    process.stdout.write(`[Pli'ef Capture] restricted extension id: ${EXTENSION_ID}\n`);
  }
});
