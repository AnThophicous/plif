# Effort Visual Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make effort changes visibly and honestly animated in the terminal UI, with distinct visual identities for Max, Ultra, UltraCode, Plif, and the standard levels.

**Architecture:** Add a pure effort-visual registry that owns mode labels, animation patterns, color stops, and status copy. Feed that registry into the existing shared Ink animation clock, prompt frame, and effort dock. A short transition state will animate immediately after a mode change without making idle sessions repaint forever.

**Tech Stack:** TypeScript, React, Ink, Node test runner, existing theme/pulse utilities.

## Global Constraints

- Preserve the existing Ink renderer and shared animation clock.
- Keep terminal cell widths stable across animation frames.
- Do not add dependencies.
- Preserve user-selected themes and existing palette override behavior.
- Keep reduced/limited terminals functional through ASCII-safe patterns.
- Verify with focused unit tests, typecheck/build, and the CLI link path.

---

### Task 1: Define effort visual identities and pure animation helpers

**Files:**
- Create: `packages/cli/src/effort-visuals.ts`
- Create: `packages/cli/test/effort-visuals.test.ts`

**Interfaces:**
- Produces `effortVisual(effort?: string): EffortVisual`.
- Produces `effortPulseCells(effort, elapsedMs, active): readonly EffortPulseCell[]`.
- Produces `effortTagline(effort, working): string`.

- [ ] **Step 1: Write failing tests** for stable pulse width, frame movement, mode-specific patterns, fallback effort labels, and stable taglines.
- [ ] **Step 2: Run the focused test and confirm it fails** because the module does not exist.
- [ ] **Step 3: Implement the registry** with separate palettes/patterns for `max`, `ultra`, `ultracode`, `plif`, and quiet standard levels.
- [ ] **Step 4: Run the focused test and confirm it passes.**

### Task 2: Make the shared frame and dock render effort-specific motion

**Files:**
- Modify: `packages/cli/src/components/FocusFrame.tsx`
- Modify: `packages/cli/src/components/PlifDock.tsx`
- Modify: `packages/cli/src/components/Prompt.tsx`
- Modify: `packages/cli/src/animation-activity.ts`
- Modify: `packages/cli/test/focus-frame.test.ts`
- Modify: `packages/cli/test/animation-activity.test.ts`

**Interfaces:**
- `FocusFrame` accepts the selected effort and uses its color stops for active edge motion.
- `Prompt` forwards the selected effort and transition state to `FocusFrame`.
- `PlifDock` paints a fixed-width moving energy ribbon and mode-specific status copy.
- `animationClockActive` accepts a short-lived effort transition flag.

- [ ] **Step 1: Add tests** proving active frame colors differ by effort, pulse geometry remains stable, and transition activity starts the clock.
- [ ] **Step 2: Implement the effort-aware frame and dock without changing layout widths.**
- [ ] **Step 3: Run focused tests and fix any renderer contract errors.**

### Task 3: Trigger and display a visible transition when effort changes

**Files:**
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/components/PlifDock.tsx`
- Modify: `packages/cli/src/components/Prompt.tsx`

**Interfaces:**
- App owns a bounded `effortTransitioning` state lasting 1.8 seconds after a successful effort change.
- Prompt receives `effort` and `transitioning`.
- Dock receives `transitioning` separately from real `working` state.

- [ ] **Step 1: Set the bounded transition state only after `setEffort` has validated and persisted the new effort.**
- [ ] **Step 2: Pass transition state through the live render tree and keep real working labels tied to actual work.**
- [ ] **Step 3: Build and run the full relevant test suite.**

### Task 4: Build, link, and smoke-check the installed CLI

**Files:**
- Modify: no source files unless verification exposes a defect.

- [ ] **Step 1: Run `npm run build`.**
- [ ] **Step 2: Run `npm link --workspace @plif/cli`.**
- [ ] **Step 3: Verify `Get-Command plif` and `plif version`.**
- [ ] **Step 4: Run the effort command manually and inspect that the dock/frame visibly changes without duplicated history.**

