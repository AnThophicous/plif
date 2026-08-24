# DME Spyx — Component DNA

Use this reference when choosing a replacement from an existing product or a
reference site.

The purpose is not to describe everything visible. Capture only properties that
change which candidate is appropriate.

## 1. Slot identity

Determine:

- component role;
- screen/layout owner;
- frequency of exposure;
- product importance;
- primary action;
- state/data dependencies;
- structural width;
- sticky/fixed/static behavior.

## 2. Structure fingerprint

For headers:

- logo position;
- nav position;
- nav count;
- CTA count;
- utility/account region;
- row count;
- constrained vs edge-to-edge;
- overlay vs document flow;
- sticky behavior;
- mobile transformation.

For footers:

- column/group count;
- brand continuation;
- legal/trust region;
- newsletter/action;
- social;
- locale;
- product/status links;
- collapse behavior.

For other slots:

- dominant axis;
- grouping model;
- content density;
- primary interaction;
- repeated-unit behavior;
- overflow ownership;
- disclosure model.

## 3. Visual fingerprint

Record relationships, not every pixel.

### Type
- quiet / expressive;
- serif / sans / mono / mixed;
- contrast between display/body/label;
- density;
- casing;
- numeric behavior.

### Space
- compact / normal / expansive;
- consistent / editorial irregularity;
- page-edge behavior;
- relationship between internal and external space.

### Shape
- square / subtle radius / rounded / pill;
- border-first / surface-first / shadow-first;
- divider behavior.

### Color
- surface dominance;
- ink contrast;
- accent scarcity;
- semantic state treatment;
- transparency.

### Motion
- none / state-only / spatial / expressive;
- scroll-linked behavior;
- menu transition;
- reduced-motion expectation.

## 4. Behavioral fingerprint

Ask:

- what changes on scroll;
- what opens;
- what remains visible;
- how current location is indicated;
- what changes when authenticated;
- what changes on mobile;
- what keyboard path exists;
- which controls are persistent;
- which state is URL-driven vs local.

## 5. Signature vs commodity

Split findings:

### Preserve
Product-specific behavior or visual language that should survive.

### Opportunity
Generic or weak behavior that a new candidate can improve.

### Forbidden regression
Something the current component already gets right and the replacement must not
break.

Example:

```text
PRESERVE
- compact 64px-ish shell rhythm
- high-contrast primary CTA
- active route underline
- one-level mobile nav

OPPORTUNITY
- generic centered nav
- weak account separation

FORBIDDEN REGRESSION
- sticky header cannot cover anchor targets
- keyboard account menu must survive
```

## 6. Reference-site extraction

When analyzing another site, separate:

- principle;
- implementation;
- branding.

Example:

Observed:
`logo left / nav center / CTA detached right / header floats over hero`

Principle:
`brand, exploration, and conversion occupy three distinct visual zones`

Adaptation:
`keep the three-zone tension but use host typography, routes, tokens, and mobile
menu conventions`

This is more useful than copying raw CSS.

## 7. Candidate distance

Candidate distance is the amount of adaptation needed.

### Near
Same structural model and behavior; mostly visual port.

### Medium
Strong visual fit but behavior/spacing/token adaptation required.

### Far
Different navigation or interaction architecture.

Prefer Near/Medium for fast swaps.

Use Far only when its advantage justifies structural change and DME wireframe
logic has been considered.

## 8. Transplant invariant

Before adapting the winner, write one sentence defining why it was selected.

Examples:

- preserve the editorial split between navigation and account action;
- preserve the edge-to-edge footer closure with one concentrated conversion band;
- preserve the compact command-bar density and keyboard-first focus treatment.

If adaptation destroys that sentence, the transplant failed even if the result is
"on brand."
