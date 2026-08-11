import fs from 'node:fs/promises';
import path from 'node:path';

import { PlifError } from '../errors.js';
import type { Tool, ToolContext, ToolResult } from './tools.js';
import { DME_SKILLS, DME_SKILL_PACKAGE } from './skill-packages/dme.js';

export type SkillScope = 'project' | 'user' | 'builtin';

export interface SkillPackage {
  readonly id: string;
  readonly name: string;
}

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly scope: SkillScope;
  readonly file: string;
  readonly instructions: string;
  readonly package?: SkillPackage;
}

const SKILL_FILE = 'SKILL.md';
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}$/;

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseSkill(source: string, file: string, scope: SkillScope): Skill | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(stripBom(source));
  if (!match) return null;

  const [, frontmatter, body] = match;
  const fields = new Map<string, string>();

  for (const line of (frontmatter ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) fields.set(key, value);
  }

  const name = fields.get('name') ?? path.basename(path.dirname(file));
  const description = fields.get('description') ?? '';
  if (!NAME_PATTERN.test(name) || !description) return null;

  return { name, description, scope, file, instructions: (body ?? '').trim() };
}

async function readSkillsFrom(dir: string, scope: SkillScope): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  for (const entry of entries) {
    const file = path.join(dir, entry, SKILL_FILE);
    try {
      const source = await fs.readFile(file, 'utf8');
      const skill = parseSkill(source, file, scope);
      if (skill) skills.push(skill);
    } catch {
      continue;
    }
  }
  return skills;
}

export interface SkillSources {
  readonly workspace: string;
  readonly root: string;
  readonly builtin?: readonly Skill[];
}

const SCOPE_RANK: Record<SkillScope, number> = { builtin: 0, user: 1, project: 2 };

export interface SkillDraft {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly scope: 'project' | 'user';
}

export class SkillRegistry {
  #skills = new Map<string, Skill>();
  #sources: SkillSources | null = null;

  static async load(sources: SkillSources): Promise<SkillRegistry> {
    const registry = new SkillRegistry();
    registry.#sources = sources;

    for (const skill of sources.builtin ?? BUILTIN_SKILLS) registry.#add(skill);
    for (const skill of await readSkillsFrom(path.join(sources.root, 'skills'), 'user')) {
      registry.#add(skill);
    }
    for (const skill of await readSkillsFrom(
      path.join(sources.workspace, '.plif', 'skills'),
      'project',
    )) {
      registry.#add(skill);
    }

    return registry;
  }

  #add(skill: Skill): void {
    // Precedence, not arrival order: a user skill written during a session must
    // not displace the project skill that already shadows it on disk, which is
    // what the reload after a restart would do.
    const current = this.#skills.get(skill.name);
    if (current && SCOPE_RANK[current.scope] > SCOPE_RANK[skill.scope]) return;
    this.#skills.set(skill.name, skill);
  }

  /** Write a skill to disk and make it loadable without a restart. */
  async create(draft: SkillDraft): Promise<Skill> {
    if (!this.#sources) {
      throw new PlifError('INTERNAL', 'this registry was not loaded from a workspace', {
        hint: 'Build it with SkillRegistry.load so it knows where skills live.',
      });
    }
    if (!draft.description.trim()) {
      throw new PlifError('INVALID_ARGUMENT', 'a skill without a description cannot be routed', {
        hint: 'The description is the only thing the model sees until the skill loads.',
      });
    }
    if (!draft.instructions.trim()) {
      throw new PlifError('INVALID_ARGUMENT', 'a skill without instructions has nothing to load');
    }
    if (draft.description.includes('\n')) {
      throw new PlifError('INVALID_ARGUMENT', 'the description must be one line', {
        hint: 'It is written into frontmatter, which is parsed line by line.',
      });
    }

    const directory =
      draft.scope === 'project'
        ? path.join(this.#sources.workspace, '.plif', 'skills')
        : path.join(this.#sources.root, 'skills');

    const file = await writeSkill(directory, draft);
    const skill: Skill = {
      name: draft.name,
      description: draft.description.trim(),
      scope: draft.scope,
      file,
      instructions: draft.instructions.trim(),
    };
    this.#add(skill);
    return skill;
  }

  get(name: string): Skill | null {
    return this.#skills.get(name) ?? null;
  }

  list(): Skill[] {
    return [...this.#skills.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get size(): number {
    return this.#skills.size;
  }

  catalogue(): string {
    if (this.#skills.size === 0) return '';
    const standalone: Skill[] = [];
    const packaged = new Map<string, { package: SkillPackage; skills: Skill[] }>();

    for (const skill of this.list()) {
      if (!skill.package) {
        standalone.push(skill);
        continue;
      }
      const group = packaged.get(skill.package.id) ?? { package: skill.package, skills: [] };
      group.skills.push(skill);
      packaged.set(skill.package.id, group);
    }

    const sections: string[] = [];
    if (standalone.length > 0) {
      sections.push(standalone.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n'));
    }
    for (const group of [...packaged.values()].sort((a, b) =>
      a.package.name.localeCompare(b.package.name),
    )) {
      sections.push(
        [
          `Package: ${group.package.name} [active]`,
          ...group.skills.map((skill) => `  - ${skill.name}: ${skill.description}`),
        ].join('\n'),
      );
    }
    return sections.join('\n\n');
  }
}

export function skillTool(registry: SkillRegistry): Tool {
  return {
    spec: {
      name: 'skill',
      description:
        'Load the full instructions for one of the available skills. Call this before ' +
        'doing work the skill covers — its instructions replace your default approach ' +
        'for that task. The catalogue in your system prompt lists what exists.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact skill name from the catalogue' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const name = typeof input['name'] === 'string' ? input['name'] : '';
      const skill = registry.get(name);

      if (!skill) {
        const known = registry.list().map((s) => s.name);
        return {
          output:
            `No skill named "${name}".` +
            (known.length ? ` Available: ${known.join(', ')}` : ' No skills are installed.'),
          ok: false,
        };
      }

      return {
        output: `${skill.package ? `# Skill package: ${skill.package.name}\n\n` : ''}# Skill: ${skill.name}\n\n${skill.instructions}`,
        ok: true,
      };
    },
  };
}

export function createSkillTool(registry: SkillRegistry): Tool {
  return {
    spec: {
      name: 'create_skill',
      description:
        'Write a reusable skill to disk and make it loadable in this session without a ' +
        'restart. Use it when the user asks to save a procedure, checklist, or way of ' +
        'working for next time. Writing the same name and scope again replaces that ' +
        'skill. Load the skill-creator skill first: the description field is routing ' +
        'metadata and a weak one makes the skill unreachable.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Lowercase letters, digits and hyphens; how the skill is loaded',
          },
          description: {
            type: 'string',
            description:
              'One line saying when to use this skill. The only text the model sees ' +
              'until the skill is loaded, so name the triggering situation.',
          },
          instructions: {
            type: 'string',
            description: 'The skill body: the procedure to follow, in markdown',
          },
          scope: {
            type: 'string',
            enum: ['project', 'user'],
            description:
              'project writes to .plif/skills in this workspace and travels with the ' +
              'repository; user writes to the plif root and applies everywhere',
          },
        },
        required: ['name', 'description', 'instructions', 'scope'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const scope = input['scope'];
      if (scope !== 'project' && scope !== 'user') {
        return { output: 'scope must be "project" or "user"', ok: false };
      }

      try {
        const skill = await registry.create({
          name: String(input['name'] ?? ''),
          description: String(input['description'] ?? ''),
          instructions: String(input['instructions'] ?? ''),
          scope,
        });

        const active = registry.get(skill.name);
        const shadowed = active && active.file !== skill.file;

        return {
          output:
            `Wrote the ${skill.scope} skill "${skill.name}" to ${skill.file}.` +
            (shadowed
              ? ` A ${active.scope} skill of the same name still takes precedence, so ` +
                `loading "${skill.name}" returns that one until it is removed.`
              : ` Load it by name with the skill tool; it is available now.`),
          ok: true,
        };
      } catch (error) {
        const message = PlifError.is(error) ? error.message : String(error);
        const hint = PlifError.is(error) && error.hint ? ` ${error.hint}` : '';
        return { output: `${message}.${hint}`, ok: false };
      }
    },
  };
}

export async function writeSkill(
  dir: string,
  skill: { name: string; description: string; instructions: string },
): Promise<string> {
  if (!NAME_PATTERN.test(skill.name)) {
    throw new PlifError('INVALID_ARGUMENT', `"${skill.name}" is not a valid skill name`, {
      hint: 'Use lowercase letters, digits and hyphens; start with a letter or digit.',
    });
  }

  const target = path.join(dir, skill.name, SKILL_FILE);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.instructions.trim()}\n`,
    'utf8',
  );
  return target;
}

export const BUILTIN_SKILLS: readonly Skill[] = [
  {
    name: 'skill-creator',
    description:
      'Turn a way of working into a skill plif can load next time, and write it to disk',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `A skill is a procedure the agent loads instead of improvising. Write one when a
way of working would otherwise be re-explained every session; do not write one
for a task that happens once, for a fact that belongs in project instructions,
or for behaviour the default prompt already governs.

Use the create_skill tool to write it. It stores the file and makes the skill
loadable immediately, so you can test it in the same session.

## Choose the scope first

**project** writes to .plif/skills in the current workspace. Choose it when the
procedure depends on this repository: its build, its conventions, its review
rules, its deploy steps. It travels with the code and takes precedence over a
user skill of the same name.

**user** writes to the plif root and applies in every workspace. Choose it for
a way of working that is about the person, not the project.

When both would work, choose project. A skill that lives next to the code it
describes stays true longer than one that does not.

## The description is the whole routing decision

The body is invisible until something loads it. The description is the only
text in the model's context, so it must answer one question: in what situation
should this be loaded?

- Name the trigger, not the topic. "Review a diff for correctness, not style"
  routes; "code review helper" does not.
- Write the situation, not the quality. "Find the cause of a bug before changing
  anything" beats "expert debugging assistance".
- Use the words that appear in a real request, so a matching prompt is
  recognisable.
- One line, no newline, no restating the skill name.

If you cannot write the description in one line, the skill is doing more than
one thing. Split it.

## Write the body as decisions

The reader is an agent that already knows how to program and already has the
default instructions. The skill earns its place by removing a choice, not by
adding encouragement.

- Open with the failure this prevents. One or two sentences, concrete.
- Give an order of operations when order matters, and say why a step comes
  where it does.
- Prefer a rule with a threshold over an adjective. "Stop at three failed
  attempts and reassess" is a rule; "be persistent" is not.
- Say what to do when the evidence is missing, not only when it is present.
- Name the tools and files the procedure actually uses, and nothing you have not
  confirmed exists.
- End with a check the agent can run against its own output.

Do not restate the default prompt, do not add generic advice ("be thorough",
"consider edge cases"), do not pad with headings that carry one sentence, and
never use emoji. Apply the anti-ai-slop skill to the prose.

Length follows the procedure. A skill that fits on one screen and is followed
beats a long one that is skimmed.

## Test it before you call it done

1. Load it back with the skill tool and read what came out. A body that reads
   as advice rather than instruction needs another pass.
2. Name three requests that should load it, and one that plausibly could but
   should not. If the description does not separate them, rewrite it.
3. Follow the skill on a real task and note where you had to decide something
   the skill left open. Add that decision.

## Updating and removing

Writing the same name and scope again replaces the file, so an update is one
call. Tell the user what changed. To remove a skill, delete its directory under
.plif/skills or the plif root; the registry rebuilds from disk at startup.`,
  },
  {
    name: 'anti-ai-slop',
    description:
      'Write copy for the person who will actually read it, and cut everything that reads as generated',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `Every string you write has exactly one reader. Write for that reader, in that
reader's vocabulary, and stop when they have what they need.

This governs prose you author: interface labels, error and empty states,
notifications, CLI output, onboarding and marketing text, release notes,
documentation, commit messages, pull-request bodies, and your own replies. It
does not change program behaviour.

## Decide the reader before the first sentence

Ask where the string renders, not who asked for it.

**Ships to a person using the product.** Labels, buttons, placeholders, toasts,
validation and error text, empty states, emails, onboarding, landing pages,
customer release notes, terminal output the operator reads. Write end-user
voice. This is the default; when the answer is unclear, it is this one.

**Ships to a person building against the code.** Files under a docs directory,
API references, code comments, architecture records, migration and contributing
guides, commit messages, pull-request descriptions, changelogs for library
consumers, failures that only fire in a build or test. Write developer voice.
Naming a module, flag, type, file path, or exit code is correct here and wrong
in the other column.

The exception is narrow. "The user is a developer" does not move product copy
into the developer column: a developer using a tool is still a user of that
tool, and a settings screen in a database client is end-user copy. The
artifact's destination decides, never the audience's job title.

### End-user voice

- Name the thing by what it does for the reader, not by the class that
  implements it. "Could not reach the server" beats "HTTP 502 from upstream".
- An error says what happened, what it means for the reader, and what to do
  next. If there is nothing they can do, say so and say who is fixing it.
- Use the words the reader already uses. If the interface says "workspace" and
  users say "project", either rename the concept or say "project".
- Keep internal vocabulary out of the surface: no class, hook, table, queue,
  endpoint, reducer, buffer, or index in a sentence a customer reads.
- Keep stack traces and error codes out of the primary line. Put them behind a
  details affordance for the person who will paste them into a bug report.
- Second person, present tense, active voice. "Your changes are saved" beats
  "Changes have been successfully persisted".

### Developer voice

- Be exact: real symbol names, real paths, real flags, real defaults, real
  versions, real exit codes.
- State the contract. What it takes, what it returns, what it throws, what it
  mutates, what it costs.
- Document the surprising part. A parameter list the signature already shows is
  not documentation.
- Say when something must not be used, and what to use instead.
- Examples are minimal and runnable. An example that cannot be pasted and run is
  decoration.

## Say each thing once

Redundancy is the most common failure and the hardest to see while writing.

- One fact lives in one place. If the heading says it, the first sentence does
  not repeat it. If the code above shows it, the paragraph below does not
  narrate it.
- No introduction announcing what you are about to say, and no summary
  repeating what you just said. Anything under roughly two screens needs
  neither.
- Do not caption the obvious. A section named Installation does not open with
  "This section explains how to install".
- Do not restate the request back to the user before answering it.
- Fold notes that repeat the body into the body, or delete them.
- Every sentence must change what the reader knows or does. Read each one and
  delete it when it fails that test.

## Never write these

The pattern is on the left, what to write instead is on the right.

| Pattern | Write instead |
| --- | --- |
| "Great question", "Certainly", "I would be happy to" | the answer |
| "It is not X. It is Y." | the claim, once |
| "is not just a Z, it is a W" | what it is |
| "In today's fast-paced world", any scene-setting opener | the first real sentence |
| leverage, utilize, delve, unlock, elevate, empower, seamless, robust, powerful, comprehensive, cutting-edge, game-changing | use, explore, or nothing |
| "simply", "just", "easily", "obviously" | nothing; it was not easy or they would not be reading |
| three adjectives where one is true | the true one |
| a rhetorical question you immediately answer | the answer |
| hedge stacks: "may potentially be able to" | one modal verb, or a fact |
| a closing offer of further help | end at the last useful sentence |
| emoji, decorative bullets, whole sentences in bold | plain text |

Headings, bullets, and tables are for genuinely parallel material. Three
sentences are three sentences, not a bulleted list of three items.

## Length is a result, not a target

Write what the reader needs and stop. Do not pad to look thorough or truncate to
look terse. A long section is fine when the subject is genuinely large; it is
not fine when each idea appears twice.

## Before handing it over

1. Which column is this string in, and is its vocabulary from that column?
2. Does every error say what to do next?
3. Is any fact stated twice? Delete the weaker instance.
4. Did a banned pattern survive? Rewrite it.
5. Read it in one pass. Anything you skip while reading, the reader skips too.
   Cut it.`,
  },
  {
    name: 'dme-frontend',
    description:
      'Build or redesign production frontend interfaces with a distinctive visual direction, responsive component architecture, accessible states, and visual proof',
    scope: 'builtin',
    file: '<builtin>',
    package: DME_SKILL_PACKAGE,
    instructions: `Use this for any interface you build or redesign: a page, screen, component,
dashboard, landing page, email, printable document, or slide deck. For web work it
governs both the visual result and the frontend decisions that determine whether
that result remains coherent, accessible, responsive, and maintainable.

The failure it exists to prevent is the generic result: a layout that could
belong to any product, assembled from framework defaults, that nobody
remembers. An interface with no point of view has already failed, however clean
the code behind it is.

Apply decisions in this order: the user's explicit constraints, the project's
existing product and design language, an approved reference, then the heuristics
in this skill. Do not erase a real identity to demonstrate your own taste. Do not
copy a reference mechanically; identify the principles that create its effect and
express them through the product's content and constraints.

## Design context comes before pixels

Never start from scratch when the project can tell you what it already looks
like. Before writing a line of CSS, spend real effort locating:

- token and theme files: CSS custom properties, Tailwind config, theme objects,
  SCSS variables, design-token JSON;
- existing components and how they compose, with their exact numbers;
- typography actually in use: font files in the repository, font-face rules,
  imports, the real scale;
- brand assets already committed: logos, icons, illustrations, imagery;
- product copy, so the new surface sounds like the old ones.

Copy exact values. If the existing card radius is 5px, write 5px; do not round
it to 4 or snap it to a scale you prefer. When the repository disagrees with the
published conventions of a library it resembles, the repository wins.

If the project has none of this and the user supplied no reference, say so in
one line, then design an identity and record it. Never invent a brand mark for a
real company and never redraw a real logo from memory: set the name in type and
note the gap.

## Work in this order

Do not jump from the request to JSX or CSS. Complete these stages in sequence and
use them to form the implementation plan; combine adjacent stages into checkpoints
rather than turning every stage into plan ceremony:

1. **Reconnaissance.** Identify the framework, routing, rendering model, styling
   system, package versions, component library, asset pipeline, test commands,
   and the exact surface being changed. Inspect adjacent screens and render the
   current interface when possible.
2. **Product frame.** Establish the user, the job this surface performs, the
   primary action, content hierarchy, required states, device constraints, and
   what success looks like. Design around the real task, not around decoration.
3. **Visual direction.** Choose one intentional aesthetic, one memorable move,
   and the nearest generic default to avoid. If the request or reference already
   settles the direction, proceed instead of asking the user to choose it again.
4. **Foundation.** Define or extend project-native tokens for type, colour,
   spacing, shape, depth, layout, and motion before styling individual sections.
5. **Component architecture.** Map page regions, reusable primitives, state
   ownership, data boundaries, and responsive behavior. Build focused components
   against the foundation instead of accumulating one monolithic page.
6. **Assembly and states.** Compose the page, navigation, interactions, and real
   content. Implement loading, empty, error, validation, disabled, overflow, and
   long-content behavior wherever the product can reach those states.
7. **Polish and proof.** Render the result, inspect it at representative sizes,
   operate it with keyboard and pointer, run project checks, fix what the evidence
   reveals, and repeat. A first render is a draft, not a handoff.

The existing stack wins. Do not migrate frameworks, replace the styling system,
add a component library, or introduce a dependency merely because another stack
would be easier to generate. For a genuinely new project, choose the smallest
stack that satisfies the requested interaction and maintenance needs, inspect the
scaffolder's current options, and initialize it non-interactively in the verified
target.

## Commit to a direction

Pick one aesthetic direction and execute it precisely. Intentionality is what
reads as designed; intensity is not. Severe minimalism and loud maximalism both
work. The timid middle never does.

Before building, resolve this four-line brief as part of the implementation plan.
Share it when the user is choosing or approving a direction; otherwise use it as
a working decision and keep it out of source-code comments:

- **Who and what for** - the reader, and the single job this surface does.
- **Direction** - the aesthetic, named: editorial broadsheet, brutalist utility,
  swiss international, art deco geometry, terminal technical, organic and
  hand-made, luxury restraint, retro-futurist, toy-like, industrial signage.
  Name one, or invent one. Do not leave it implicit.
- **The one memorable thing** - the single move someone would describe to a
  colleague: a type treatment, a grid that breaks, a colour that appears once, a
  transition. If you cannot name it, you have not designed anything yet.
- **What it is not** - the nearest default you are deliberately refusing.

Vary the direction between projects and between options. Converging on the same
look every time is the same failure as having no look.

## The identity kit

An identity is a small set of decisions applied consistently. Express it through
the project's native token mechanism; for CSS projects, define custom properties
at the appropriate theme root and consume them through components. Repeated raw
values below the token layer are a defect. A deliberate one-off value is allowed
only when it creates a named visual move that does not pretend to be a reusable
token.

**Type.** Use one or two families, a third only with a concrete role: one may
carry character in display text while another stays quiet and legible in body
copy. Start with fonts already licensed and loaded by the project. Do not reach
for Inter, Roboto, Arial, Helvetica, or a stock system stack by reflex; they are
valid only when the product already uses them or their voice fits the brief.
Choose a deliberate scale, set line-height per step, keep prose measure readable,
and tune tracking as display size grows.

**Colour.** One dominant surface, one ink, one accent that carries the identity,
plus semantic states. Dominance beats distribution: a palette giving every
colour equal area looks unresolved. Make the accent rare enough that it means
something. When the product supports both light and dark, author each deliberately
instead of deriving one with an inversion filter.

**Space.** One scale, geometric or 4/8-based, and nothing off it. Space is the
strongest signal of care; tight margins read cheap faster than any colour
mistake.

**Shape.** Radius, border weight, and shadow are one system. Pick a corner
language - square, subtle, pill - and hold it. Shadows come from one light
source with consistent direction and blur; two shadow styles on one page read as
two designers.

## Composition

- Establish a grid, then break it deliberately once or twice. An untouched
  twelve-column grid is a template, not a design.
- Asymmetry, overlap, and diagonal flow are available. Centred stacks are what
  everyone else ships.
- Choose generous negative space or controlled density and commit. The middle
  reads as unconsidered.
- Give the page one entry point. Everything cannot be emphasized.
- Full-bleed elements, oversized type, and edge-anchored content are the cheapest
  ways out of the card-inside-a-container look.

## Component and style architecture

- Build from tokens to primitives to composed components to page sections. Do not
  create a local design system beside an existing one or bypass shared primitives
  with ad-hoc markup.
- Give each component one clear visual or behavioral responsibility. Extract a
  unit when it repeats, owns state, isolates an effect, or can be understood and
  tested independently; do not split markup into meaningless wrapper components.
- Keep business and data rules outside presentational styling. Make loading and
  failure states explicit inputs rather than hidden branches scattered through
  the tree.
- Prefer semantic elements and native browser behavior. Add ARIA only when native
  HTML cannot express the interaction. Use accessible names as automation hooks;
  add test identifiers only when user-visible semantics cannot select the target
  reliably.
- Keep selectors local, predictable, and shallow. Avoid specificity escalation,
  global leakage, arbitrary utility piles, duplicated media queries, and magic
  numbers that encode the same decision differently across components.
- Keep the render path deterministic. Do not create layout from random values,
  current timestamps, unstable array keys, or client-only measurements when CSS
  or stable data can express it.
- Follow the default no-comment rule. Clear component boundaries, prop names,
  state models, and token names must explain the implementation.

## Surface and depth

Do not settle for flat fills when atmosphere is available: layered transparency,
a gradient mesh, grain or noise, a repeating geometric pattern, a hairline rule
system, an inset shadow, a considered blur behind a floating element. Keep it to
one texture idea used consistently across the surface.

## Motion

- Spend the motion budget on one orchestrated moment, usually first paint: a
  staggered reveal that establishes hierarchy. Scattered micro-animations cost
  more and read as noise.
- Every interactive element needs hover, active, focus-visible, and disabled
  states, and they belong to the identity rather than to browser defaults.
- Durations: 120-200ms for state, 250-400ms for entrances, longer only for
  something the user is deliberately watching. Ease out for entrances, ease in
  for exits, linear only for a spinner.
- Animate transform and opacity. Animating layout properties is why interfaces
  feel cheap.
- Honour reduced-motion preferences.

## The interface is copy

Text is the largest visual element on most screens, so write it as part of the
design: real content, never lorem ipsum, never placeholder counts that could not
occur. Empty, loading, error, and long-content states are designs, not
afterthoughts - a layout that only works on the happy path is unfinished. Apply
the anti-ai-slop skill to the strings themselves.

Use real project assets before inventing new ones. When custom imagery materially
improves the surface and an authorized image tool exists, generate imagery sized
for the actual composition and inspect the result before integrating it. Otherwise
use deliberate typography, geometry, or a clearly identified asset gap; never ship
a broken placeholder, random hotlinked image, fabricated company logo, or generic
stock image that contradicts the product.

Use the project's icon set when it has one. If it has none, choose one coherent
maintained set only when a dependency is justified, or use text and CSS geometry.
Do not use emoji as icons, mix icon families, or draw improvised SVG paths that
imitate a library.

## Surface notes

- **Landing or marketing page.** The first screen carries the identity. Below
  it, vary the section rhythm - full-bleed, split, editorial column, oversized
  figure - instead of repeating one card grid. One call to action, repeated, not
  five competing ones.
- **Application screen.** Density is the design. Hierarchy beats decoration and
  the accent marks state rather than chrome. Design the table, the empty state,
  and the loading skeleton before the hero.
- **Document or print.** Physical units only, no viewport units. Body 14-16px at
  1.55-1.7 line-height, real CSS columns when text flows across pages, a
  repeating header row on long tables.
- **Email.** Nested presentation tables, every style inlined, no javascript, no
  web fonts, one 600px column, padded-cell buttons rather than styled buttons.
- **Deck or slide.** A fixed 16:9 stage, nothing under 24px, titles above 48px,
  one idea per slide, and parallel titles that read as a table of contents.

## Options

When the user is choosing a direction rather than approving one, give three to
five genuinely distinct options, not one design with three colour swaps. Vary
the dimension that matters: layout metaphor, type treatment, density, colour
strategy, iconography. Start with the by-the-book version and grow more
adventurous with each. Label every option with its direction in one phrase so
the user can say what they want more of.

## Non-negotiable

A design failing any of these is broken, not unpolished.

- Contrast: 4.5:1 for body text, 3:1 for large text and meaningful non-text.
  Check the accent against its real background, not against white.
- Keyboard: every interactive element reachable and operable, focus visible and
  never removed without a replacement, tab order matching visual order.
- Semantics: real buttons, labelled inputs, one page-level h1 and a descending
  heading order, alt text describing what the image conveys. A reusable component
  must fit the host page's hierarchy instead of assuming its own page-level h1.
- Responsive: no horizontal page scroll at 320px; wide tables, code blocks, and
  diagrams scroll inside their own container; touch targets at least 44px.
- Forms: persistent labels, useful autocomplete attributes, errors associated
  with their fields, no validation communicated by colour alone, and focus moved
  only when doing so helps the user recover.
- Themes: every colour scheme the product supports renders deliberately. Do not
  add a second theme solely to satisfy this skill, and never fake one with an
  inversion filter.
- Discoverability: public pages need a specific title, useful description,
  semantic landmarks, one meaningful h1, and crawlable content. Add canonical,
  social, or structured metadata only when the project has the real URL and data;
  never fabricate production metadata.
- Performance: size images explicitly, choose appropriate formats, avoid layout
  shift, lazy-load below-the-fold media, minimize blocking font and script work,
  and keep animation off the main layout path. Do not trade interaction latency
  or legibility for a decorative effect.
- Compatibility: preserve server rendering and hydration assumptions, input
  methods, supported browsers, localization expansion, and content-security
  policy established by the project.

## Verify what you built

You have not designed anything until you have looked at it.

- Run it. Use the project's dev server or open the file, and judge the real
  rendering rather than your mental model of the code.
- Look at the result as an image when the runtime allows it. Capture the narrowest
  supported mobile width, an intermediate width, and a representative desktop
  width using project breakpoints when they exist. Check hierarchy, alignment,
  optical spacing, cropping, overflow, and whether the memorable thing is visible.
- Exercise the states you claimed to design: initial, loading, empty, error,
  validation, disabled, longest plausible content, narrowest viewport, every
  supported theme, keyboard only, and reduced motion. Inspect the browser console
  for runtime, hydration, asset, and accessibility failures.
- Test interaction, not only appearance. Navigate in logical tab order, activate
  controls without a pointer, resize across breakpoints, and verify that state is
  not lost or duplicated unexpectedly.
- Run the focused tests and the project's relevant typecheck, lint, build, and
  smoke checks after the last edit. A screenshot does not prove behavior, and a
  passing test does not prove visual quality; both forms of evidence are required
  when the environment supports them.
- Fix what you observed, render again, and repeat the affected checks. Stop only
  when another visual pass produces no material correction.

When nothing in the environment can render it, say plainly that the design is
visually unverified and name the exact check you could not run. Do not substitute
code inspection for pixels or call the interface production-ready.

## Banned defaults

Each of these is a tell. Use one only when the project's existing design already
does.

- Bluish-purple gradients, and the purple-to-pink hero.
- Glassmorphism as the whole idea; blur with nothing to float above.
- Cards whose only differentiator is a coloured left border.
- Emoji standing in for icons, and emoji anywhere in a plif artifact.
- Untouched framework defaults: component library out of the box, Bootstrap
  spacing, Material shadows, one large radius on everything.
- The stock rhythm of hero, three feature cards, testimonial, call to action.
- Centred single-column everything.
- Drop shadows over flat colour with no light logic.
- Gradient text on a headline as the only typographic idea.
- Icon, heading, one grey sentence, repeated across a grid.
- A hand-drawn SVG standing in for a real icon: use the project's icons, a real
  icon set, or plain type.
- Dashboard shorthand that turns every value into an identical rounded card,
  every label into muted uppercase text, and every action into a floating pill.
- Decorative animation on every element. Motion needs hierarchy and a reason;
  constant movement is not polish.
- Placeholder copy, fake analytics, impossible sample values, broken image boxes,
  and blank rectangles standing in for content the layout depends on.
- A component library shipped with its defaults untouched. If the project uses a
  library, preserve its behavior and accessibility while applying the product's
  tokens, density, typography, and state language.

Before handoff, ask: is the product identity recognizable without its logo, is
the primary action obvious, does the page remain coherent in every reachable
state and supported size, and did you inspect the final pixels after the last
change? If any answer is no, the interface is not finished.`,
  },
  ...DME_SKILLS,
  {
    name: 'investigate',
    description: 'Find the cause of a bug or failure before changing anything',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `Work from evidence, not from a guess about what is probably wrong.

1. Reproduce it first. Run the failing test or command and read the actual
   error, in full. If you cannot reproduce it, say so and stop — a fix for a
   failure you never saw is a guess.
2. Read the code the error points at before reading anything else. Follow the
   stack, not your intuition about where the bug "feels like" it lives.
3. Form one hypothesis and state it. Then find the cheapest way to prove it
   wrong. A hypothesis you cannot falsify is not one.
4. Only once you can explain the failure end to end, change something.
5. Re-run the same reproduction. If it now passes, say what the cause was, not
   just what you changed.

Do not fix symptoms you cannot connect to the cause. Two unexplained fixes that
happen to make a test pass will fail differently next week.`,
  },
  {
    name: 'review-change',
    description: 'Review a diff for correctness, not style',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `Read the change for what it does, not for how it looks.

Order to work in:
1. What is this change trying to do? Get that from the code, not the message.
2. Does it do that? Trace the actual path, including the error path.
3. What breaks that used to work? Look for callers, not just the edited file.
4. What input makes this wrong? Boundaries, empty, null, concurrent, very large.
5. Is anything now unreachable, unused, or duplicated?

Report only what you can demonstrate with a concrete failing case: the inputs,
and what goes wrong. "This could be clearer" is not a finding. Formatting is
never a finding.

If the change is correct, say so plainly and stop.`,
  },
  {
    name: 'write-tests',
    description: 'Add tests that would catch a real regression',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `A test earns its place by failing when something is actually broken.

Before writing one, run the existing suite and read a few tests, so the new ones
match how this project already tests things.

Write tests for:
- the behaviour the code promises, at its boundaries
- the bug you just fixed, in a form that fails on the old code
- the invariant that would be expensive to get wrong

Do not write tests that assert the implementation back at itself, that mock the
thing under test, or that pass no matter what the code does.

Verify the test fails before the fix and passes after. A test never seen red is
not evidence of anything.`,
  },
];
