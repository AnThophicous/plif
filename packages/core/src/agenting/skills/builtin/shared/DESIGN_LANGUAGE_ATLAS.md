# DME Design Language Atlas — Contextual Visual Intelligence

Load this reference only when visual direction is materially open, a design system is being created/repaired, or a reference must be translated into implementable visual rules.

This is not a style menu. It is a **selection and rejection system**.

---

## 1. Select direction from product pressure

Before choosing a visual language, resolve:

- product and primary job;
- audience expertise;
- frequency of use;
- information density;
- trust/consequence level;
- efficiency vs exploration;
- platform expectations;
- existing brand/product evidence;
- accessibility constraints;
- rendering/performance budget;
- content/media reality.

Then define a dominant language and, if useful, one supporting language.

Hybrids are valid only when the dominant grammar remains obvious.

Good examples:
- Swiss + Neo-Minimal;
- Data-Dense + Dark Premium;
- Editorial + Brutalist;
- Minimal + Organic;
- Glass as a material layer inside an otherwise restrained system.

Bad hybrid:
- glass + neo-brutal + clay + cyber + bento because each seems interesting.

---

## 2. Design DNA contract

Before meaningful visual implementation, define internally:

- **direction** — dominant design language;
- **tone** — emotional character;
- **density** — sparse / balanced / compact;
- **geometry** — rectangular / soft / irregular / mixed with rules;
- **radius law** — where curvature appears and why;
- **border law** — separators, outlines, emphasis;
- **elevation law** — what earns depth;
- **color strategy** — neutral base, chroma budget, semantic colors;
- **typography strategy** — families, roles, width/weight behavior;
- **icon strategy** — existing family / selected coherent set / bespoke;
- **motion strategy** — causal, spatial, restrained, kinetic;
- **interaction character** — quiet / tactile / immediate / theatrical;
- **spacing rhythm** — compact / editorial / generous;
- **imagery strategy** — none / product evidence / editorial / illustration / spatial;
- **signature move** — one memorable relationship;
- **counter-default** — nearest generic pattern intentionally refused.

Design DNA is the source of truth for later choices.

---

## 3. Language families

### Neo-Minimal
**Use when:** premium productivity, developer tools, editorial products, portfolios, product pages where hierarchy can carry identity.  
**Signals:** reduction, strong type, few focal points, generous but purposeful negative space, restrained surfaces, limited palette.  
**Authenticity test:** hierarchy still feels designed with color and effects removed.  
**Reject when:** whitespace harms density, tiny gray type replaces hierarchy, or black/white emptiness is mistaken for identity.

### Swiss / International / Editorial
**Use when:** content-heavy products, documentation, research, premium corporate, portfolios, publishing.  
**Signals:** explicit grid, alignment, asymmetric composition when useful, typography-led hierarchy, modular rhythm, restrained chroma.  
**Authenticity test:** content relationships become clearer because of the grid.  
**Failure:** "Swiss" used as excuse for sterile templates or unreadably small type.

### Data-Dense / Professional
**Use when:** admin, finance, analytics, operations, developer tools, enterprise.  
**Priority:** scan speed → alignment → state clarity → keyboard efficiency → density → decoration.  
**Signals:** compact spacing, stable columns, restrained surfaces, high information-to-chrome ratio, meaningful color.  
**Failure:** dashboard cosplay, every number in a tile, decorative charts, spacious marketing rhythm applied to expert workflows.

### Dark Premium
**Use when:** media, creative tools, developer products, focused professional surfaces, premium brand contexts.  
**Signals:** near-black tonal ladder, disciplined luminance, thin separators, scarce accent, crisp typography, controlled glow only when material/semantic.  
**Authenticity test:** hierarchy survives with glow removed.  
**Failure:** cyberpunk by default, neon borders everywhere, purple gradients as the identity.

### Monochromatic Systems
**Use when:** strong coherence, tool-like focus, or brand restraint matters.  
**Signals:** one hue or neutral family varies through lightness/chroma; semantic exceptions remain legible.  
**Risk:** state meaning collapses if every semantic color is forced into one hue.

### Brutalism
**Use when:** culture, fashion, music, editorial, experimental brands where raw structure supports identity.  
**Signals:** visible grid, hard contrast, blunt borders, unconventional but intentional typography, low ornamental polish.  
**Authenticity test:** roughness is systematic and improves character/communication.  
**Failure:** broken alignment or unfinished CSS labeled "brutalist."

### Neo-Brutalism
**Use when:** playful consumer, education, creator brands, campaigns.  
**Signals:** strong borders, offset shadows, saturated limited palette, chunky geometry, obvious states.  
**Failure:** every component becomes the same outlined rectangle.

### Organic / Soft
**Use when:** wellness, hospitality, food, lifestyle, sustainability, human-centered consumer products.  
**Signals:** warmer palette, humanist type, natural curves, relaxed rhythm, restrained texture, asymmetric organic geometry.  
**Failure:** random blobs with no compositional role.

### Clay
**Use when:** friendly education, family, onboarding, playful consumer products.  
**Signals:** tactile soft volume, inflated geometry, paired soft shadows, friendly palette.  
**Risk:** childish tone, low density, weak contrast, heavy shadow cost. Use selectively.

### Neumorphic / Soft UI
**Use rarely:** accent surfaces where low relief supports a tactile metaphor.  
**Risk:** affordance and contrast failure.  
**Rule:** never make the entire interaction model depend on subtle shadow polarity.

### Glass
**Use when:** overlay, navigation, media controls, spatial/transient surfaces where underlying context matters.  
**Model:** backdrop → translucency → blur → border luminance → foreground contrast → elevation → environmental tint.  
**Failure:** transparent white card + blur repeated everywhere, low contrast, huge filter regions.

### Adaptive / Liquid Glass
Treat as a **functional material layer**, not a trend.
Use for navigation/toolbars/floating controls where visual separation must adapt to content beneath.
Reason about:
- backdrop luminance and saturation;
- opacity and contrast fallback;
- edge/internal highlights;
- environmental tint;
- motion/refraction illusion;
- reduced-transparency strategy;
- GPU/filter cost.
Do not cover dense content hierarchy in glass.

### Bento / Modular
**Use when:** content genuinely benefits from heterogeneous modular grouping and scanable regions.  
**Signals:** meaningful span/size differences, spatial grouping, explicit hierarchy.  
**Failure:** fashionable fragmentation into identical rounded cells.

### Spatial / Immersive
**Use when:** exploration, storytelling, visualization, product understanding, spatial media.  
**Tools may include:** CSS 3D, canvas, Three.js/R3F, WebGL/WebGPU when justified.  
**Gate:** the spatial model must improve comprehension or experience enough to pay for accessibility/performance/complexity.  
**Fallback:** useful non-spatial experience must remain.

### Retro-Futurist
**Use when:** brand identity genuinely supports terminal/CRT/industrial/technical nostalgia.  
**Vocabulary:** mono/bitmap accents, grids, scanline texture, technical labels, chromatic aberration used selectively.  
**Failure:** sacrificing readability to imitate an old display.

### Y2K / Cyber / Techno
**Use when:** fashion, music, youth culture, campaigns, experimental product identity.  
**Vocabulary:** chrome, iridescence, compressed/display type, high-energy gradients, pixel accents.  
**Failure:** decorative intensity overwhelms task clarity.

---

## 4. Gradient purpose taxonomy

A gradient must have a job:

- **ambient** — atmosphere/background field;
- **directional** — guide attention or indicate movement;
- **semantic** — encode state/category/progression;
- **material** — simulate lighting/surface;
- **brand** — express a known identity.

If the answer is "to make it modern", remove it.

Gradient text is not a typographic system.

---

## 5. Typography engine

Typography is architecture.

### Selection criteria
Evaluate:
- product personality;
- x-height and UI readability;
- width/condensation and density;
- weight/variable axes;
- numeral quality;
- punctuation/symbol coverage;
- code legibility when relevant;
- language coverage;
- rendering quality;
- licensing/availability;
- font payload.

Prefer existing licensed/local fonts first.

### Functional categories
- **Neutral UI sans:** quiet application readability.
- **Geometric/modern sans:** stronger identity, use with density awareness.
- **Humanist sans:** approachable, readable, often useful for accessibility-heavy products.
- **Editorial serif:** reading, contrast, brand/editorial voice; usually not dense control copy.
- **Monospace:** code, technical labels, tabular data where semantics justify it.
- **Display:** identity/focal moments only.

### Pairing strategies
Prefer:
- one superfamily;
- neutral body + expressive display;
- UI sans + editorial serif;
- UI sans + technical mono.

Before loading another family, ask whether size/weight/width/optical size/case can create the hierarchy.

### Type roles
Create only needed roles:
`display | page-title | section-title | body | compact-body | label | metadata | data | code | annotation`

For each decide:
- family;
- responsive size;
- line height;
- weight;
- tracking;
- measure;
- wrapping/truncation behavior;
- numeric features where relevant.

Reading measure often lands around 45–80 characters per line, but context outranks a fixed number.

Avoid:
- huge text as hierarchy compensation;
- 12px body copy by reflex;
- gray-on-gray body text;
- too many weights;
- arbitrary tracking.

---

## 6. Icon and SVG engine

### Icon source precedence
1. existing project icon system;
2. platform-native system when product is strongly platform-specific;
3. one coherent library;
4. custom SVG only when semantics/brand require it.

Common coherent families include Lucide, Material Symbols, Phosphor, Heroicons, and Radix Icons. Choose based on existing stack and visual weight, not popularity.

Do not casually mix families.

Normalize:
- stroke/fill style;
- optical size;
- visual weight;
- baseline;
- bounding box;
- corner language.

For unfamiliar actions, prefer `icon + label` over icon-only.

### Custom SVG
Use for brand marks, diagrams, bespoke symbols, visualization, loaders, product-specific illustration.

Require:
- correct `viewBox`;
- scalable geometry;
- optimized/reusable paths;
- `currentColor` when semantically useful;
- accessible name/title when informative;
- `aria-hidden` when decorative;
- no giant inline duplicate blobs.

Do not redraw a common icon if the project already has it.

---

## 7. Color system

Generate roles, not isolated hex values.

Useful semantic layers:
- canvas/background;
- surface;
- raised/overlay surface;
- primary/muted/subtle foreground;
- subtle/strong border;
- primary action + hover/pressed/foreground;
- focus ring;
- success/warning/danger/info;
- selected/active states.

When supported by project/browser requirements, perceptual spaces such as OKLCH can make scale relationships easier to reason about.

Do not adopt cutting-edge color features if compatibility or tooling makes the system harder to maintain.

Themes are authored semantic mappings, not simple inversion.

---

## 8. Spacing, shape, depth

### Spacing
Use a coherent rhythm (often based on 4px, but not dogmatically).
Spacing communicates relationship:
- inside control;
- related pair;
- component;
- group;
- section;
- page frame.

One optical exception can be intentional. Repeated unexplained exceptions are drift.

### Radius
Define a hierarchy or a deliberate near-zero system.
Pills belong to semantically pill-like controls, tags, avatars, segmented cases — not every element.

### Elevation
Model levels by meaning:
`flat → grouped → floating control → popover → modal → critical overlay`

Depth may use luminance, border, shadow, blur, scale, or spatial separation. Not every elevated element needs a shadow.

---

## 9. Motion character

Motion should communicate:
- causality;
- continuity;
- state;
- hierarchy;
- completion.

Use duration proportional to distance and importance.

Common small-state transitions often feel right in roughly 100–250ms; larger spatial transitions may be longer. These are starting ranges, not laws.

Prefer transforms/opacity for common motion when practical.

Respect reduced motion.

A frequent action should never feel slower because the designer wanted a flourish.

---

## 10. Signature discipline

One memorable visual or interaction moment is usually enough.

Possible signature moves:
- unusual but useful hero composition;
- distinctive navigation rhythm;
- typography relationship;
- data visualization;
- elegant spatial transition;
- expressive empty state;
- product-specific framing/divider system.

Do not make every component the signature.

Memorability depends on contrast and restraint.

---

## 11. Anti-imitation rule

References may inform:
- hierarchy;
- composition;
- typography;
- material;
- density;
- motion;
- interaction.

Extract rules and synthesize them into the target product.

Do not clone proprietary branding, copy, business data, or accidental defects.

High fidelity may increase only when explicitly requested/authorized and must still respect target accessibility and product contracts.
