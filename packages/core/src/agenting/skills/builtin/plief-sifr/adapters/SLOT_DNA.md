# Slot DNA Reference - component transplant (Pli'ef Sifr adapter)

Use this reference only during component discovery/transplant.

Component DNA is not a checklist of visual properties. It is a compact model of **what must survive, what may change, and why the slot exists**.

---

## 1. Slot identity

Record:
- slot kind;
- user job;
- primary action;
- frequency;
- trust/consequence;
- dominant device/input;
- host design-system authority.

Examples:
`global-header`, `workspace-sidebar`, `checkout-summary`, `marketing-hero`, `command-search`.

---

## 2. Four fingerprints

### Structural
- container/full-bleed;
- row/stack/split/overlay;
- persistent/sticky/fixed;
- primary/secondary regions;
- alignment;
- content density;
- responsive transformation;
- overflow ownership.

### Visual
- typography voice;
- spacing rhythm;
- shape/radius;
- border/divider;
- surface/elevation/material;
- icon style;
- color/chroma behavior;
- motion character.

### Behavioral
- navigation/state;
- active/selected;
- menus/sheets;
- search;
- auth/account;
- theme/locale;
- keyboard/focus;
- scroll;
- loading/error;
- analytics/flags if contractually relevant.

### Product
- job;
- expertise;
- frequency;
- consequence;
- primary conversion/action;
- content reality.

---

## 3. Preservation classes

For each important property classify:

### Preserve
Changing it would break product behavior or deliberate identity.

### Adapt
May change to integrate candidate into host product.

### Opportunity
Current slot is weak; candidate may intentionally improve this dimension.

### Forbidden regression
Specific failure that must not occur.

Example:

```text
HEADER DNA
Preserve:
- auth/account behavior
- active route
- compact expert navigation
- sticky content offset

Adapt:
- exact height
- border treatment
- icon implementation

Opportunity:
- stronger CTA hierarchy
- clearer mobile transition

Forbidden:
- hover-only submenu
- provider demo routes
- second icon family
```

---

## 4. Signature vs commodity

Separate valuable identity from replaceable provider details.

### Signature
The reason the candidate deserves selection:
- unusual but useful structure;
- distinctive navigation rhythm;
- strong typography relationship;
- helpful motion/transition;
- excellent data composition.

### Commodity
Usually safe to remap:
- raw hex values;
- provider font;
- exact radius;
- generic icon set;
- demo content;
- provider utility wrapper.

The **transplant invariant** preserves signature while commodity details become host-native.

---

## 5. Candidate distance

Classify distance:

### Near
Same structural/behavioral model; mostly visual adaptation.

### Medium
Useful signature with moderate structural/behavior adaptation.

### Far
Requires new interaction/state architecture, significant dependencies, or design-system divergence.

Distance is not bad by itself.

Use farther candidates only when their product value justifies adaptation cost and risk.

---

## 6. DNA affinity test

Ask:
- Can host semantics/routes/state remain intact?
- Can candidate signature survive token/style adaptation?
- Does candidate fit product density/frequency?
- Does its responsive model fit the host?
- Does accessibility remain repairable at reasonable cost?
- Would it still feel native after demo branding/provider defaults disappear?

If not, rank down or reject.

---

## 7. Reference-site extraction

From references derive:
- structure;
- hierarchy;
- behavior;
- responsive transformation;
- signature move;
- typography relationship;
- density/material.

Do not copy brand/copy/data or inaccessible defects.

Translate evidence into target-product DNA.

---

## 8. Transplant invariant

Before implementation write one concise statement.

Example:

```text
TRANSPLANT INVARIANT
Keep the two-zone navigation tension and instant mobile command-sheet transition;
all raw colors, fonts, icons, and route data become host-native.
```

After adaptation, test the candidate against that sentence.

If the candidate no longer expresses it, adaptation erased the reason for choosing it.
