# DME Spyx | Component Picker

DME Spyx turns component discovery into a fast, reversible product-design workflow.

It is designed to work alongside:

- `dme-frontend`
- `dme-wireframe`
- `dme-ui-options`
- `dme-design-system`
- `dme-interactive-prototype`
- `dme-visual-verification`

Instead of immediately installing whatever looks good, Spyx:

1. inspects the current component slot;
2. extracts the site's Product/Slot DNA;
3. discovers real candidates;
4. rejects incompatible candidates;
5. shows 2–4 useful options when choice matters;
6. remembers IDs such as `H1`, `H2`, `F1`;
7. acquires only the chosen component;
8. ports it into the project's tokens, routes, state, and accessibility model;
9. renders and verifies the transplant.

This makes header/footer swaps particularly fast.

## Files

```text
DME-Spyx-Component-Picker/
├── SKILL.md
├── README.md
├── references/
│   ├── COMPONENT_DNA.md
│   ├── PROVIDER_ENGINE.md
│   └── SPYX_BRIDGE.md
├── tools/
│   └── spyx-bridge.mjs
└── extension/
    └── 21st-unlocked/
        ├── manifest.json
        ├── icons/
        └── src/
```

## Install the skill

Copy this folder into the PLIF/OpenCode skill root you use.

The machine-safe skill id is:

`dme-spyx-component-picker`

The visible title is:

**DME Spyx | Component Picker**

Restart/reload the skill registry if your agent host requires it.

## Browser integration

The included `21st-unlocked` extension is the authorized browser capture provider
supplied with this skill.

Load the unpacked folder in a Chromium-based browser:

`extension/21st-unlocked/`

The DME build adds a **Send to DME Spyx** action.

The extension remains user-driven: a component is sent only when the user clicks
the action.

## Local bridge

Run from the project you are modifying:

```bash
node /path/to/DME-Spyx-Component-Picker/tools/spyx-bridge.mjs
```

The receiver writes capsules to:

```text
.dme-spyx/inbox/
```

Keep `.dme-spyx/` out of version control unless you intentionally want design
decision artifacts committed.

If the bridge is offline, the extension downloads a `.dme-spyx.json` capsule
instead.

## Provider tooling

Spyx detects available provider capabilities instead of assuming one permanent
toolchain.

It can work with:

- project-native components;
- shadcn/ui;
- configured shadcn registries;
- current 21st.dev CLI/tools;
- 21st.dev MCP tools exposed by the agent environment;
- the included authorized browser bridge;
- Magic UI;
- Aceternity UI;
- v0 when configured.

Do not make 21st MCP a hard dependency for the whole skill.

Current provider commands and quotas can change; verify the live tool surface
before using it.

## Typical header flow

User:

```text
Me mostra 3 headers que combinem com esse site.
```

Spyx should:

- inspect existing app shell;
- preserve navigation/auth/route invariants;
- derive Header DNA;
- search real candidates;
- return `H1`, `H2`, `H3`;
- render a comparison gallery when possible.

User:

```text
H2, mas sem glass e mais baixo.
```

Spyx should:

- keep H2's transplant invariant;
- modify only requested design dimensions;
- acquire H2 if not already acquired;
- port real content/routes/state;
- keep the public Header contract stable when practical;
- verify mobile, desktop, keyboard, sticky offset, and build.

User:

```text
Troca pro H1.
```

Spyx should switch from session memory, not search again.

## Reference-site flow

User:

```text
Quero meu header baseado naquele header do site X.
```

Spyx extracts:

- structure;
- hierarchy;
- behavior;
- responsive transformation;
- signature move.

Then it searches candidates that express those principles inside the target
product's design system.

If the user requests high fidelity and the use is authorized, fidelity can be
increased without importing the reference site's branding or breaking the target
app's contracts.

## Why the browser bridge exists

The browser is often the fastest place for a human to evaluate component feel.

The agent is the better place to evaluate:

- repository compatibility;
- architecture;
- dependencies;
- accessibility;
- state;
- product fit;
- adaptation;
- verification.

The bridge connects those two strengths.

It also lets discovery/preview happen before an acquisition decision, which is
important when a provider has limited install/download budgets.

## Verification

For substantive component swaps, Spyx should cooperate with
`dme-visual-verification`.

A successful task should be able to distinguish:

- source acquired;
- source integrated;
- build passing;
- rendered result verified.

Those are not the same thing.
