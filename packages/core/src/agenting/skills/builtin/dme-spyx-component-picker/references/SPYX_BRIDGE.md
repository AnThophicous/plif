# DME Spyx — Browser Bridge Contract vNext

The bridge connects an explicit browser selection to the coding agent without treating browser DOM as production source.

External behavior is intentionally preserved:

- bind host: `127.0.0.1`;
- default port: `17321`;
- POST endpoint: `/dme-spyx/ingest`;
- capsule schema: `dme-spyx-capsule/v1`;
- inbox: `.dme-spyx/inbox/`;
- latest capsule: `.dme-spyx/inbox/latest.json`.

---

## 1. Trust boundary

The extension is user-driven.

A capsule is sent only from the extension action or imported manually.

The bridge accepts:
- requests with no `Origin` header for local CLI/manual tooling;
- Chromium extension origins;
- optionally a specific extension id when bridge is started with a restriction.

It rejects browser `Origin: null` and non-extension web origins by default.

Binding to loopback is mandatory.

---

## 2. Capsule semantics

Expected top-level schema:

```text
schema: dme-spyx-capsule/v1
capturedAt
source
component
preview
registry
handoff
```

Important distinction:

- `preview.dom` = rendered evidence;
- `registry.files` = candidate source snapshot when available;
- absence of registry source does not make preview DOM source code;
- `handoff.doNotAutoInstall` must be respected.

The agent must re-run normal provider hard gates.

---

## 3. Storage

Bridge writes:
- timestamped capsule file;
- `latest.json`.

vNext bridge writes atomically to reduce partial-file races.

The capsule controls no filesystem path.

Filename is derived through a sanitized slug.

Keep `.dme-spyx/` out of version control unless design-decision artifacts are intentionally committed.

---

## 4. Payload limits

Default max payload remains 5 MiB unless changed by bridge argument.

The bridge:
- rejects oversized `Content-Length` early;
- stops oversized streaming bodies;
- returns explicit 413 where possible.

Large preview/bundle data should not be used to bypass repository/provider acquisition.

---

## 5. Security properties

- loopback-only listener;
- origin policy;
- fixed endpoint;
- schema validation;
- sanitized filename;
- no capsule-supplied output path;
- no executable evaluation;
- no automatic install;
- no cacheable HTTP response;
- atomic writes;
- optional exact extension-origin restriction.

This is a local handoff receiver, not an internet service.

Do not expose it on `0.0.0.0`.

---

## 6. Start

Typical:

```bash
node tools/spyx-bridge.mjs
```

Options:

```text
--port <number>
--dir <inbox>
--max-bytes <number>
--extension-id <chromium-extension-id>
```

If extension id is specified, only that `chrome-extension://<id>` origin is allowed in addition to origin-less local tooling.

---

## 7. Failure modes

### Bridge offline
Extension downloads `.dme-spyx.json`; agent imports manually.

### Origin denied
Confirm request comes from authorized extension or local CLI.

### Capsule too large
Acquire source through provider tooling; avoid treating giant preview DOM as source.

### Invalid schema
Do not guess. Reject and inspect capsule producer/version.

### Preview DOM absent
Use metadata/registry source if available.

### Registry source unavailable
Preview remains design evidence; source must be acquired elsewhere or implemented natively.

### Shader
Treat standalone shader output as effect evidence requiring product/performance/accessibility gates.

---

## 8. Agent consumption

When a fresh capsule exists:

1. validate schema;
2. inspect component/source identity;
3. separate preview from source;
4. add/refresh candidate in Picker Board;
5. hard-gate compatibility/provenance;
6. do not install if request is exploratory;
7. acquire selected source through authorized path;
8. transplant into host product;
9. render/verify.

The bridge reduces handoff friction. It does not reduce engineering standards.
