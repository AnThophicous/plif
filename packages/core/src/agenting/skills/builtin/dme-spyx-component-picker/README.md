# DME Spyx | Component Picker vNext

This package is the component-discovery/transplant specialist in the modular DME frontend suite.

## Public contract preserved

Skill id:

`dme-spyx-component-picker`

Browser capsule schema:

`dme-spyx-capsule/v1`

Bridge endpoint:

`http://127.0.0.1:17321/dme-spyx/ingest`

Inbox:

`.dme-spyx/inbox/`

The vNext reconstruction changes internal decision quality and hardens the local bridge without changing the extension's normal handoff contract.

## What changed

Spyx now treats external acquisition as a code-supply-chain decision, not a visual shopping step.

Before installation it distinguishes:

`discover → preview/inspect → hard-gate → choose → acquire → transplant → render → verify`

Hard gates cover:
- stack/rendering compatibility;
- dependencies;
- behavior;
- accessibility;
- provenance/security;
- registry item blast radius;
- integration risk.

A modern registry item may write more than a single component file, so files/config/scripts/dependencies are inspected before application when tooling permits.

## Shared suite

When installed as part of the full modular pack, Spyx loads:

`../../shared/CORE_CONTRACT.md`

It then loads provider/bridge references only when relevant.

It still has a standalone core capsule and remains usable if the shared file is not available.

## Browser integration

The included Chromium extension under:

`extension/21st-unlocked/`

remains user-driven.

The user explicitly chooses **Send to DME Spyx**.

The capsule may contain:
- metadata;
- preview DOM;
- an authorized registry/source snapshot when available.

Preview DOM is evidence, not production source.

## Bridge

Run from the project being modified:

```bash
node /path/to/dme-spyx-component-picker/tools/spyx-bridge.mjs
```

Optional hardening/config:

```bash
node tools/spyx-bridge.mjs \
  --port 17321 \
  --dir .dme-spyx/inbox \
  --max-bytes 5242880 \
  --extension-id <chromium-extension-id>
```

vNext bridge:
- remains loopback-only;
- rejects normal web origins and browser `Origin: null`;
- accepts origin-less local tooling;
- accepts Chromium extension origins;
- can restrict to one extension id;
- validates schema/shape;
- enforces payload limits with 413 responses;
- uses atomic writes;
- preserves `latest.json`.

If bridge is offline, the extension's capsule-download fallback remains valid.

## Typical workflow

Open request:

`inspect slot → Slot DNA → discover → hard-gate → shortlist → choose → acquire winner → transplant → render → verify`

Specific candidate:

`inspect → hard-gate → acquire → transplant → verify`

Repeated preference change:

use stored candidate/session state; do not rediscover providers.

## Provider strategy

Prefer:
1. project-native;
2. internal/team registry;
3. configured shadcn-compatible registries;
4. live 21st CLI/MCP or authorized capture;
5. other configured providers;
6. bespoke project-native implementation.

Exact tool names, quotas, and commands are dynamic. Inspect the live tool surface before costly acquisition.

## Verification vocabulary

Do not collapse these claims:

- source discovered;
- source acquired;
- source integrated;
- build passing;
- rendered behavior verified.

They are separate evidence states.
