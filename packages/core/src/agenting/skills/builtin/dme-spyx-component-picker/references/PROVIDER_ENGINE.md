# DME Spyx — Provider Engine vNext

Provider tooling is dynamic.

This file encodes **capabilities and decision rules**, not a permanent command list.

Always inspect live tool help/config before costly acquisition.

---

## 1. Search order

Default order:

1. project-native components;
2. team/private registry already configured;
3. existing shadcn-compatible registries/config;
4. live 21st.dev CLI/MCP or authorized browser-capture path when available;
5. other configured component registries/providers such as Magic UI, Aceternity, or v0;
6. project-native bespoke implementation when external candidates do not improve the outcome.

This order is a heuristic.

User-selected source or stronger product fit can change it.

---

## 2. Project-native

Prefer existing code when it:
- already satisfies behavior/accessibility;
- can be adapted with low cost;
- preserves coherent product language;
- avoids provider/dependency overhead.

Search neighboring/unused primitives before external catalogues.

Do not rebuild a strong internal component because an external screenshot is shinier.

---

## 3. Team/private registries

Treat internal registries as high-value because they often encode:
- team conventions;
- vetted dependencies;
- known accessibility behavior;
- brand/product grammar.

Still inspect:
- current version;
- files written;
- migration compatibility;
- ownership/deprecation.

“Internal” does not mean “automatically correct.”

---

## 4. shadcn-compatible ecosystem

Modern shadcn registries may distribute more than UI components.

Before applying an item inspect:
- registry item metadata;
- files;
- `registryDependencies`;
- package dependencies;
- CSS variables/styles;
- config/rules/hooks/utilities;
- destination paths.

Configured registries may be discovered through project config or MCP/CLI tools.

Prefer search/inspection before installation.

Third-party registry code requires normal source review.

---

## 5. 21st.dev live capability

As of the 2026 ecosystem, 21st exposes CLI/MCP flows for search, code acquisition, generation, and component work. Exact commands, plans, quotas, and tool names can change.

Therefore:

1. detect installed/configured CLI or MCP;
2. inspect live help/tool schema;
3. prefer search/preview before install;
4. identify acquisition quota/cost when it affects strategy;
5. acquire only the selected candidate;
6. run normal hard gates even when the provider is trusted.

The included Spyx browser bridge is an optional human-selection handoff, not a replacement for official source acquisition.

---

## 6. Authorized browser capture

Use when:
- user evaluated a component in the browser;
- extension explicitly sends/downloads a capsule;
- preview evidence is useful before acquisition.

Capsule may contain:
- metadata;
- preview DOM;
- source/registry snapshot when available.

Trust levels:
- metadata → discovery evidence;
- preview DOM → structural/visual evidence;
- registry/source snapshot → code candidate requiring review.

Never treat preview DOM as framework production source.

---

## 7. Other public providers

For Magic UI, Aceternity, v0, or other registries:
- use only when live/configured/accessible;
- inspect license/provenance;
- inspect dependencies;
- inspect server/client assumptions;
- adapt to host design system;
- avoid importing an entire visual language for one component.

Provider brand never outranks product fit.

---

## 8. Provider selection heuristics

### Primitive/control
Prefer project-native or design-system primitive.

### Header/footer/hero/marketing block
Catalogue search can be valuable because visual/structural diversity matters.

### Complex product interaction
Prefer proven accessible primitives and source review over visual novelty.

### Data visualization
Prefer project chart stack or a library that matches data/interaction requirements; a decorative catalogue block is rarely enough.

### Visual effect
Treat as progressive enhancement with explicit performance/accessibility gate.

### Exact browser-found candidate
Use capsule to identify it, then acquire source through an authorized path.

---

## 9. Acquisition budget

Model separate costs:
- search;
- preview;
- get-source;
- install;
- generation;
- paid credits;
- dependency/runtime cost.

When install/code-copy quota is limited:
- search broadly;
- shortlist;
- inspect metadata/preview;
- acquire only winner.

Do not burn quota to create a comparison gallery.

---

## 10. Blast-radius inspection

Before install ask:

- Which files will be created/replaced?
- Does it alter global CSS?
- Does it mutate Tailwind/framework config?
- Does it add environment variables?
- Does it include scripts or server code?
- What packages/peers enter?
- Does it add another icon/motion primitive?
- Does it assume auth/data/routes?
- Does it cross server/client boundary?
- Does it import remote assets or telemetry?

Unexpected blast radius is a rejection/approval gate.

---

## 11. Source trust

Classify:

### High confidence
Project-owned/internal reviewed source with known contract.

### Medium
Public registry/provider with clear source/metadata and reasonable review path.

### Low
Preview-only DOM, opaque generated artifact, unclear provenance, unexpected executable setup.

Confidence changes autonomy.

Low-confidence source should not be installed automatically.

---

## 12. Mixing providers

Mix only when each source has a clear role and host design system normalizes them.

Reject:
- three icon systems;
- parallel button primitives;
- multiple motion runtimes for cosmetic reasons;
- incompatible CSS conventions;
- provider-specific tokens leaking across app.

The host product owns the final visual language.

---

## 13. Failure routing

Provider search fails:
→ one meaningful retry if transient → alternate provider/project-native.

Candidate source unavailable:
→ use preview as evidence → authorized source path or project-native derivation.

Install mutates too much:
→ revert isolated changes → reject or manually port only necessary source after review.

Dependency conflict:
→ find compatible variant/candidate before upgrading core framework.

Do not keep trying commands whose failure mode has not changed.
