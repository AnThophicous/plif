# DME Spyx — Provider Engine

Provider choice is a technical/product decision, not a ranking of favorite sites.

Capabilities change over time. Detect what is actually available in the current
environment before assuming commands, tokens, quotas, or registry names.

## 1. Search order

Use:

`project-native → compatible registry/source search → shortlist → acquisition`

Do not search externally before checking whether the repository already contains
a strong component or primitive.

## 2. Project-native

Prefer when:

- existing component is close;
- current design system is mature;
- external candidate would add more cost than value;
- behavioral integration dominates visual novelty.

A local component can still be redesigned using an external candidate as a
reference.

## 3. shadcn/ui and registries

Good for:

- primitives;
- accessible foundations;
- common application components;
- registry-distributed blocks;
- components intended to become owned source.

When the installed/current CLI supports them, use discovery and inspection
capabilities such as:

- registry search/list;
- dry-run;
- diff/view;
- configured namespaces.

Inspect before overwrite.

A registry item may include files, dependencies, CSS, and configuration. Treat it
as a code change, not a paste.

Community registry presence does not prove quality. Run hard gates.

## 4. 21st.dev official tooling

Good for:

- searching polished community/product components;
- blocks where visual direction matters;
- candidate discovery by description;
- generating variants when the current authorized tools expose that capability.

Detect the current official CLI/MCP/tool surface.

Do not assume an old package name or invocation when the environment can verify
the current one.

Use official search/preview capabilities before consuming an install/download
budget.

## 5. DME Spyx authorized browser capture

Use when:

- the user is browsing 21st.dev visually;
- the exact candidate is easier to choose in the browser;
- preview DOM/metadata materially improves ranking;
- official acquisition budget should not be spent before selection;
- an authorized registry/source snapshot is available through the user's browser
  session.

The extension can send a DME capsule to the local receiver.

A capsule is evidence.

It does not bypass stack compatibility or DME adaptation.

## 6. Magic UI

Good for:

- focused motion/effect primitives;
- marquee/dock/beam/shimmer-like visual mechanisms;
- registry-compatible effects when they support the selected design thesis.

Do not choose an effect provider for basic structural UI.

Treat effect cost as optional until proven valuable.

## 7. Aceternity UI

Good for:

- showcase/expressive blocks;
- distinctive backgrounds and motion;
- visually strong reference implementations.

Manual-copy sources require extra attention to:

- peer dependencies;
- global CSS;
- animation runtime;
- icon system;
- client-only boundaries.

Port deliberately.

## 8. v0

Use when configured and the task benefits from generated bespoke composition
rather than selecting an existing catalog component.

v0 is a generator, not evidence that a result fits the product.

Run candidates through the same DNA/hard-gate/adaptation process.

## 9. Provider selection heuristics

### Primitive/control
Prefer project-native or shadcn-compatible primitive.

### Header/footer/hero/marketing block
Prefer catalog/block search: project registries, 21st, verified shadcn registries,
Magic/Aceternity when their visual language fits.

### Complex product interaction
Prefer strong primitives plus product-native composition. Do not force a marketing
block library into application architecture.

### Visual effect
Use effect provider only if Signature DNA calls for it.

### Exact browser-found 21st candidate
Use Spyx capture to transfer identity/preview/source snapshot when authorized,
then adapt in repo.

## 10. Acquisition budget

Do not install every finalist.

For each candidate:

1. search;
2. inspect metadata/preview/source diff;
3. reject incompatible;
4. present finalist;
5. acquire winner.

If an official provider limits installs, this workflow protects the quota.

## 11. Source trust

Before adopting third-party code inspect:

- provenance;
- declared license/usage terms when relevant;
- dependencies;
- network calls;
- embedded secrets/tokens;
- analytics;
- remote assets;
- dynamic script injection;
- global styles;
- unsafe HTML;
- framework assumptions.

Do not treat a pretty preview as a trust signal.

## 12. Mixing providers

You may source from several providers across a product.

Normalize:

- tokens;
- icons;
- focus;
- motion runtime;
- primitive APIs;
- semantic state;
- dependency duplication.

Do not leave visible provider boundaries in the finished product.
