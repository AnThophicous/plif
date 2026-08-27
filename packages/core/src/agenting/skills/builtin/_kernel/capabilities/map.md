# Capability Map — runtime-neutral capability contract

PLI'EF core never branches on host brand. Behavior is selected by capabilities detected at session start.

## Taxonomy

```text
fs.read, fs.write, shell.exec, git.diff, git.history,
test.run, build.run, lint, typecheck,
web.search, web.fetch,
browser.render, browser.interact,
image.inspect, package.inspect, registry.search,
vision.screenshot, subagent.spawn
```

## Protocol

1. At session start the active agent fills `.plif/artifacts/capabilities.json`:
   `{available:[...], degraded:[...], checked_at:"<iso>"}`.
2. Each module header declares `requires`, `optional`, and a `degrades_to` strategy.
3. Missing optional capability → execute the `degrades_to` strategy AND emit a degradation note in outputs.
4. Missing required capability → the module does not run; report says so plainly.

## Unbreakable honesty rules

- Never simulate execution of an absent capability.
- Never present static analysis as rendered evidence.
- Degradation notes state what could not be verified, not vague apologies.

Example entry: `requires:[fs.read] optional:[browser.render] degrades_to: "static inspection only; mark VISUAL UNVERIFIED"`.
