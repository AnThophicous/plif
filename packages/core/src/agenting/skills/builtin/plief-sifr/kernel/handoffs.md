# Handoffs â€” produced and consumed artifacts

Producers/consumers live here; schemas live in `schemas/`.

| Artifact | Written by | Read by | Schema |
|---|---|---|---|
| experience-ir.json | any phase | all phases; Galileu (constraint context) | experience-ir.schema.json |
| design-dna.json | visual-direction, design-system | implementation, verification (Pass H), component-intelligence (affinity), Orun query (visual_requirements.dna_ref) | design-dna.schema.json |
| selection-query.json | component-intelligence | Orun discover workflow | orun schema |
| selection-record.json | component-intelligence (+Orun facts) | Sifr switch-back ("volta pro H1"), Galileu (tradeoff review), final docs | orun schema |
| defect-report.json | verification | repair loop; end-user summary source | defect-record.schema.json |
| visual-grammar.json | visual-forensics | visual-direction DNA derivation | informal (documented in module) |

Within `experience-ir.json`, `motion` is governed by `schemas/motion-contract.schema.json` and each `media_contracts[]` entry by `schemas/media-contract.schema.json`. Media/spatial implementation, performance, accessibility and verification all consume the latter; do not fork private media notes in component files.

IA Contract, Visual Direction Contract, Transplant Invariant:
now SECTIONS of the IR/DNA/component records â€” the former prose blocks are superseded. Their exact semantics migrated 1:1 into those sections; cross-check them during REPAIR (`defect_classify.py` maps symptoms onto contract owners).

Tooling note: extension captures arrive under `.plief/captures/inbox/latest.json` (schema `plief-capsule/v1`, endpoint `POST http://127.0.0.1:17321/plief/ingest` unchanged) consumed by component-intelligence â€” see `adapters/CAPTURE_BRIDGE.md`.
