#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const HOST = "127.0.0.1";
const PORT = Number(arg("--port", "17321"));
const INBOX = path.resolve(arg("--dir", ".dme-spyx/inbox"));
const MAX_BYTES = 5 * 1024 * 1024;

fs.mkdirSync(INBOX, { recursive: true });

function safeSlug(value) {
  return String(value || "component")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "component";
}

function validOrigin(origin) {
  if (!origin || origin === "null") return true;
  return origin.startsWith("chrome-extension://");
}

function send(res, status, body, origin = null) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    ...(origin && validOrigin(origin) ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  });
  res.end(json);
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || null;

  if (req.method === "OPTIONS") {
    if (!validOrigin(origin)) return send(res, 403, { ok: false, error: "origin-denied" });
    res.writeHead(204, {
      ...(origin ? { "access-control-allow-origin": origin } : {}),
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    });
    return res.end();
  }

  if (req.method !== "POST" || req.url !== "/dme-spyx/ingest") {
    return send(res, 404, { ok: false, error: "not-found" }, origin);
  }

  if (!validOrigin(origin)) {
    return send(res, 403, { ok: false, error: "origin-denied" }, origin);
  }

  let bytes = 0;
  const chunks = [];

  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (bytes > MAX_BYTES) return;
    let capsule;
    try {
      capsule = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(res, 400, { ok: false, error: "invalid-json" }, origin);
    }

    if (!capsule || capsule.schema !== "dme-spyx-capsule/v1") {
      return send(res, 400, { ok: false, error: "invalid-schema" }, origin);
    }

    const slug = safeSlug(capsule?.component?.slug || capsule?.component?.name);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${stamp}-${slug}.json`;
    const target = path.join(INBOX, filename);

    // Never use a path supplied by the capsule.
    fs.writeFileSync(target, JSON.stringify(capsule, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(INBOX, "latest.json"), JSON.stringify(capsule, null, 2) + "\n", "utf8");

    send(res, 200, { ok: true, stored: path.relative(process.cwd(), target) }, origin);
    process.stdout.write(`[DME Spyx] received ${slug} -> ${target}\n`);
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`[DME Spyx] bridge listening on http://${HOST}:${PORT}/dme-spyx/ingest\n`);
  process.stdout.write(`[DME Spyx] inbox: ${INBOX}\n`);
});
