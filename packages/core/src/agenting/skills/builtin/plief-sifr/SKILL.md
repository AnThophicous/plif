---
name: plief-sifr
description: >
  Build, reshape, recreate, repair, or audit web interfaces and design systems,
  including deliberate art direction, responsive product UI, interaction and
  motion, video, 3D/WebGL, shaders, and visual QA. Use for any frontend surface;
  internal modes scale the work from a micro-fix to a complete experience.
---

# Pli'ef Sifr

Frontend Intelligence & Experience Engineering System. One entry; route the internal specialty yourself.

Do not decorate rectangles or optimize for one screenshot. Build a product surface whose structure, content, visual world, interaction, motion, accessibility, responsiveness and runtime behavior agree. Distinctiveness must come from product truth, not fashionable effects.

## State model

For every non-trivial task, first read `kernel/experience-state.md`. Durable decisions live in **ExperienceIR** (`.plif/artifacts/<surface-id>/experience-ir.json`) and its sibling artifacts. Validate every produced IR with `engines/ir_validate.py`; a field without a named consumer does not belong in it.

## Mode router

| Mode | Activate when | Read |
|---|---|---|
| DISCOVER | new surface or unclear product reality | `modules/product-intelligence.md`; use `references/experience-archetypes.md` only for a full surface or material ambiguity |
| STRUCTURE | IA, navigation, density or task flow is unsettled | `modules/structure.md`; add interaction when behavioral |
| VISUALIZE | direction is open or a reference was supplied | `modules/visual-forensics.md`, `modules/visual-direction.md`; load `references/atlas.md` only here or during systemic visual repair |
| SYSTEMIZE | tokens, primitives, themes or cross-surface rules are needed | `modules/design-system.md` |
| BUILD | implementation work | `modules/implementation.md`, plus only the interaction, motion, responsive, accessibility, performance and component modules the surface needs |
| MEDIA / SPATIAL | imagery, video, 3D, WebGL/canvas, shaders or dynamic materials matter | `modules/media-spatial.md` plus performance, accessibility and motion as applicable |
| REPAIR | defects are reported or discovered | `modules/verification.md` + the root-owner module |
| RECREATE | screenshot/site/reference becomes an original implementation | visual forensics -> structure inference -> BUILD with transplant discipline |
| VERIFY / AUDIT | rendered QA is requested | verification + relevant performance/accessibility/media checks |

Fast path: for a local micro-edit, inspect the owner, edit, run the smallest meaningful check, and stop. Full ceremony on trivial work is a failure.

## Kernel files

Read once per non-trivial task:

- `kernel/orchestration.md` — pipelines, escalation and repair-loop ownership.
- `kernel/handoffs.md` — artifact producers/consumers and schemas.
- `kernel/degraded-mode.md` — honest behavior when capabilities are missing.

Risk, evidence and capability vocabulary are canonical in `_kernel/`; never duplicate them here.

## Non-negotiable decisions

1. Product frame before pixels: identify user, job, primary action, density, risk, device and dominant experience archetype. Structure before style when the decision sequence is unsettled.
2. For a new or substantially reshaped surface, write DesignDNA before components. It must connect a product truth to a visual thesis, composition law, typography voice, color/material/light behavior, asset world, motion character, one signature relationship and one counter-default. Validate full visual work with `engines/ir_validate.py --dna <path> --strict-visual`.
3. Choose media by explanatory or emotional value, not spectacle. CSS/SVG/image/video/shader/3D are different costs, not a quality ladder. Heavy media requires a contract and useful fallback before implementation.
4. External parts follow `PROJECT-NATIVE > ORUN > ADAPT > COMPOSE > BUILD`. If external discovery is warranted, create `adapters/orun-selection-query.template.json`-shaped input and record the decision from `adapters/orun-selection-record.template.json`. Hard compatibility, provenance, accessibility and budget gates run before aesthetic ranking.
5. Named libraries are ingredients, never art direction. Paper Shaders, Magic UI and similar sources earn a place only when one bounded mechanism advances the thesis; adapt them into the host system and remove demo aesthetics and unpaid runtime cost.
6. Motion needs hierarchy and choreography: one signature sequence at most, a small recurring motif set, causal microfeedback, interruption behavior and reduced-motion equivalents. Repeated fade-up-on-scroll is not a motion language.
7. Every substantive change ends `RENDER -> INSPECT -> CLASSIFY OWNER -> REPAIR ROOT -> RE-RENDER affected matrix`. The responsive contract defines widths/states; dynamic media adds keyframes, fallbacks and worst-case contrast frames. Use `modules/verification.md`.
8. Accessibility and performance are construction inputs in the IR, not post-processing. Never claim pixel-perfect, accessible, fast or production-ready without corresponding evidence.

## Completion contract

Deliver the real surface in the existing stack; preserve its architecture, content truth and authorization boundaries. Report material decisions, changed files, validation performed and remaining limitations using VERIFIED / INFERRED / UNVERIFIED evidence labels. If rendering or interaction could not be exercised, say exactly which viewport, state, motion or media cases remain unverified.
