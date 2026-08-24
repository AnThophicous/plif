# DME Spyx — Browser Bridge Contract

The included browser extension is an authorized 21st.dev capture helper.

The DME integration adds an explicit local handoff without requiring native
messaging.

## Architecture

```text
21st.dev page
    |
    | content.js
    | identifies component + captures preview DOM
    v
21st∞ extension
    |
    | chrome.runtime message
    v
background.js
    |
    | POST JSON to localhost
    v
127.0.0.1:17321/dme-spyx/ingest
    |
    v
tools/spyx-bridge.mjs
    |
    v
.dme-spyx/inbox/<timestamp>-<slug>.json
```

The receiver binds to loopback only.

If the local bridge is not running, the extension falls back to downloading the
capsule JSON so it can be imported manually.

## Start

From the project root:

```bash
node /path/to/dme-spyx-component-picker/tools/spyx-bridge.mjs
```

Optional:

```bash
node tools/spyx-bridge.mjs --port 17321 --dir .dme-spyx/inbox
```

Keep the receiver running only while selecting components.

## Capsule schema

Current schema:

`dme-spyx-capsule/v1`

Important fields:

```json
{
  "schema": "dme-spyx-capsule/v1",
  "capturedAt": "...",
  "source": {
    "provider": "21st.dev",
    "pageUrl": "...",
    "previewParam": "..."
  },
  "component": {
    "name": "...",
    "description": "...",
    "username": "...",
    "slug": "...",
    "tags": []
  },
  "preview": {
    "dom": "...",
    "bundleHtmlUrl": "...",
    "previewUrl": "..."
  },
  "registry": {
    "available": true,
    "files": []
  }
}
```

`registry.files` is included only when the user's browser session is authorized
to read the component registry source and the payload is within the safety size
budget.

## Security properties

The receiver:

- binds to `127.0.0.1`;
- accepts only the DME ingest route;
- limits request size;
- validates the schema shape;
- writes to a fixed inbox directory;
- never uses paths supplied by the capsule as filesystem paths;
- does not execute received code;
- rejects ordinary http/https browser origins.

A capsule contains untrusted third-party code/HTML.

The coding agent must inspect it before integration.

## Failure modes

### Bridge offline
Extension downloads the capsule JSON.

### Preview DOM absent
Use metadata/source when available. Ask the user to let the preview finish
rendering only when that missing evidence blocks selection.

### Registry source unavailable
Use the capsule as visual/structural evidence, then acquire through an authorized
provider path.

### Large source payload
Registry source is omitted from the capsule and the acquisition step happens
after selection.

### Shader
The extension's standalone shader output is a visual/runtime artifact, not
automatically a React component. Treat it as a separate integration problem.

## Agent consumption

When a new capsule arrives:

1. verify schema;
2. identify candidate;
3. inspect preview DOM and source snapshot separately;
4. run stack/dependency hard gates;
5. add candidate to the current Picker Board;
6. do not auto-install unless the request is already specific.

The browser is the visual selector.

DME Spyx is the integration brain.
