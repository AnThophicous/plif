# Sifr capability needs

Uses kernel protocol (`_kernel/capabilities/map.md`). Package-specific mapping:

| Capability | Modules that need it | Degradation here |
|---|---|---|
| browser.render / browser.interact | verification, visual-direction comparison, forensics measurement | degraded-mode capsule rows apply |
| image.inspect / vision.screenshot | visual-forensics | textual properties only; grammar PARTIAL/ASSUMED |
| package.inspect / registry.search | component-intelligence, Orun path | native-only mode + UNVERIFIED external facts |
| test.run / build.run / typecheck / lint | implementation, verification exit gates | named checks NOT EXECUTED in confidence statement |
| subagent.spawn | orchestration orthogonal work | serialized decomposition |
