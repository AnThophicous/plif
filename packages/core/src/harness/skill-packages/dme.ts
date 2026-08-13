import type { Skill, SkillPackage } from '../skills.js';

export const DME_SKILL_PACKAGE: SkillPackage = {
  id: 'dme-skill',
  name: 'DME Skill',
};

const builtin = (
  name: string,
  description: string,
  instructions: string,
): Skill => ({
  name,
  description,
  instructions: instructions.trim(),
  scope: 'builtin',
  file: '<builtin:dme-skill>',
  package: DME_SKILL_PACKAGE,
});

export const DME_SKILLS: readonly Skill[] = [
  builtin(
    'dme-design-system',
    'Extract, create, or extend a frontend design system from real product evidence, with coherent tokens, assets, component contracts, and usage guidance',
    `Use this when the task is about a design system, shared visual foundations,
component libraries, brand translation, theming, or making several surfaces feel
like one product. Do not load it for a one-off CSS correction with no reusable
design decision.

## Establish the source of truth

Inventory the evidence before defining a system: current theme and token files,
rendered product surfaces, component families, font files, icon sources, brand
assets, content voice, state patterns, and exact numeric values. Prefer source
code or structured design data over screenshots. A screenshot can reveal rhythm
and hierarchy, but it cannot prove component contracts or token values.

Write down what is observed, what is inferred, and what is missing. Never invent
a company logo, redraw a mark from memory, or silently substitute a font or icon
family. If a source asset is unavailable, preserve the gap and name it.

## Build from foundations upward

1. Define base values and semantic aliases for colour, typography, spacing,
   shape, depth, layout, and motion using the project's native token mechanism.
2. Map the complete component inventory found in the source. Do not create the
   standard components you expected to find; create or extend what the product
   actually uses.
3. Specify each component's states, variants, sizes, content limits, accessibility
   contract, and responsive behavior before multiplying examples.
4. Compose representative screens from those components to prove that the
   system works above the primitive level.
5. Document where each value and asset came from, deliberate additions, and any
   substitutions the user must approve.

One global entry point should reach every token and font rule a consumer needs.
Keep raw values below the token layer rare and deliberate. Do not duplicate an
existing library beside itself or wrap every primitive in a meaningless adapter.

## Prove coherence

Render foundation specimens, component states, and at least one representative
composition. Check light and dark themes only when the product supports them.
Exercise long copy, localization expansion, keyboard focus, disabled and error
states, and narrow layouts. A token list without rendered consumers is not a
verified design system.`,
  ),
  builtin(
    'dme-wireframe',
    'Explore information architecture, page structure, navigation, and user flow through several deliberately different low-fidelity interface directions',
    `Use this when the product structure or flow is unsettled and the user needs
to compare approaches before visual polish. The deliverable is a decision tool,
not a grey version of the final interface.

Start with the user, the job, the primary action, the information that must be
visible, the decisions in the flow, and the device constraints. Use real labels
and realistic content lengths where they affect structure. Placeholder styling
is acceptable; placeholder meaning is not.

Produce three to five structurally different options. Vary navigation model,
content hierarchy, density, progressive disclosure, and interaction sequence,
not merely card placement or colour. Give every option a stable short id, a
one-line thesis, its strongest advantage, and its main cost. Order them from the
most conventional defensible solution to the most exploratory.

Keep visual treatment intentionally quiet so typography, spacing, and decoration
cannot hide a weak flow. Show the states and transitions that make each concept
understandable. Preserve previous rounds when iterating so the user can refer to
an earlier option without ambiguity.

Before recommending a direction, walk the primary task through every option and
check that navigation remains understandable on both the narrowest and widest
supported layouts. Do not proceed to high fidelity until one structure is chosen
or the request explicitly authorizes you to choose.`,
  ),
  builtin(
    'dme-ui-options',
    'Create and compare multiple high-level visual directions for the same interface when the user has not yet chosen an aesthetic',
    `Use this only when visual direction is genuinely open. If the project already
has a design language or the user supplied an approved reference, follow it
instead of manufacturing a choice.

Create three to five concepts that share the same product requirements but differ
in a meaningful design thesis. Change the composition, typographic voice, density,
colour strategy, image treatment, shape language, and motion character as a
coherent set. Colour swaps of one layout are one option, not several.

Give every concept a stable id and a name that describes its direction. State the
audience, memorable move, product fit, accessibility or performance risk, and the
default pattern it deliberately avoids. Begin with a restrained project-native
direction, then increase experimentation without turning later options into
novelties that cannot ship.

Present options at comparable content, viewport, and completeness so the
comparison is honest. Preserve old ids across rounds and derive refinements from
the chosen concept explicitly. Once the user or project evidence settles the
direction, stop generating alternatives and commit to the selected system.`,
  ),
  builtin(
    'dme-interactive-prototype',
    'Build a realistic interactive frontend prototype that demonstrates product flows, state transitions, validation, and responsive behavior without pretending to be production backend code',
    `Use this for a clickable prototype, interaction study, product demo, or
high-fidelity flow whose purpose is to test behavior before full production
integration. Do not turn a static mockup into a fake app by adding random hover
effects; model the states that answer a product question.

Define the scenario and completion path first. List the screens, transitions,
inputs, validation rules, reversible actions, loading moments, empty and error
states, and the data that must persist during the session. Use the repository's
framework and design primitives when they exist. For a standalone prototype,
choose the smallest runtime that supports the required interactions.

Keep prototype state deterministic and inspectable. Use realistic fixtures and
stable identifiers. Simulate a server boundary behind a narrow adapter so the UI
does not confuse mock data with production integration. Never add credentials,
real payments, destructive service calls, or misleading success states to make a
demo feel complete.

Implement keyboard, pointer, focus, validation, navigation, and reduced-motion
behavior for the path being demonstrated. Transitions must communicate state or
spatial continuity; decorative motion cannot delay input or obscure feedback.

Run the prototype through the primary path, an invalid path, recovery from an
error, back navigation, refresh expectations, and representative mobile and
desktop widths. Report plainly which boundaries are simulated and which behavior
is production-ready.`,
  ),
  builtin(
    'dme-visual-verification',
    'Audit a rendered frontend at representative viewports and interaction states, then iterate on visual, responsive, accessibility, and runtime defects',
    `Use this after frontend implementation or when the user asks for a visual UI
review. Source inspection and passing tests are inputs, not substitutes for
looking at the rendered result.

Start the real application using its documented workflow. Capture or inspect the
narrowest supported mobile width, an intermediate width, and a representative
desktop width, preferring project breakpoints over arbitrary device presets.
Exercise every state affected by the change: initial, loading, empty, populated,
long content, validation, error, disabled, focus, open overlays, and each existing
theme.

Review in this order:

1. hierarchy and whether the primary action is immediately legible;
2. alignment, rhythm, optical spacing, typography, cropping, and overflow;
3. responsive reflow, touch targets, zoom, and horizontal scrolling;
4. keyboard order, visible focus, accessible names, contrast, and reduced motion;
5. console errors, failed assets, hydration warnings, layout shifts, and slow
   interaction caused by decorative work.

Record concrete defects with viewport, state, impact, and owning component. Fix
the responsible token, primitive, or layout rule rather than patching each
instance. Render the affected states again after the last edit, then run focused
tests and the project's relevant typecheck, lint, and build.

If no rendering or browser capability exists, state that visual verification was
not possible and name the exact missing check. Never describe an interface as
polished or production-ready from code inspection alone.`,
  ),
];
