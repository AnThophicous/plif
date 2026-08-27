# Pli'ef Capture Bridge — protocol v2

Local handoff receiver between the user-driven browser extension
(`extension/plief-capture-ext/`) and the coding agent, feeding component-intelligence.
Protocol renamed coherently on BOTH sides in this version; if you previously
loaded an older build of the extension, remove it and re-load this folder once —
the endpoints below are what both sides now speak.

## External contract

- bind host: `127.0.0.1` (loopback mandatory)
- default port: `17321`
- endpoint: `POST /plief/ingest`
- capsule schema: `plief-capsule/v1`
- inbox: `.plief/captures/inbox/` inside the target project
- latest capsule: `.plief/captures/inbox/latest.json`
- offline fallback (bridge down): the extension downloads `.<project>-capture.json`;
  import manually through component-intelligence

## Capsule semantics

Top-level fields:

```text
schema: plief-capsule/v1   capturedAt   source   component
preview{}                  registry{}   handoff{}
```

- `preview.dom` = rendered evidence only;
- `registry.files` = candidate source snapshot when available;
- preview DOM is NEVER treated as framework source;
- `handoff.doNotAutoInstall` must be honored;
- normal hard gates still apply before any acquisition.

## Security properties (unchanged discipline)

loopback-only listener · origin policy (Chromium extension origins +
origin-less local tooling; browser `Origin: null` and web origins rejected) ·
optional exact extension-id restriction (`--extension-id`) · schema validation ·
5 MiB default payload cap with early 413 · sanitized filename slugs ·
no capsule-supplied output path · no executable evaluation · no automatic install ·
no cacheable responses · atomic writes.

## Run

```bash
node adapters/plief-capture-bridge.mjs            # defaults below
node adapters/plief-capture-bridge.mjs --port 17321 \
     --dir .plief/captures/inbox --max-bytes 5242880 --extension-id <id>
```

## Failure modes

bridge offline → offline fallback above · origin denied → authorized extension or local CLI only ·
oversized payload → acquire source elsewhere · invalid schema → reject, inspect producer/version ·
registry source absent → preview stays evidence; source acquired through authorized paths or implemented natively.

Behavioral regression cases live in the Sifr eval pack (E20–E22, E31–E35 equivalents).
