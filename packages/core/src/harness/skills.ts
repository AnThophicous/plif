import fs from 'node:fs/promises';
import path from 'node:path';

import { PlifError } from '../errors.js';
import type { Tool, ToolContext, ToolResult } from './tools.js';

export type SkillScope = 'project' | 'user' | 'builtin';

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly scope: SkillScope;
  readonly file: string;
  readonly instructions: string;
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
    return this.list()
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n');
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
        output: `# Skill: ${skill.name}\n\n${skill.instructions}`,
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
    name: 'dme-eclipse-design',
    description:
      'Design an interface with a committed visual identity, built from the project real design context and verified by looking at it',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `Use this for any interface you build or redesign: a page, a screen, a component,
a dashboard, a landing page, an email, a printable document, a slide deck. It
governs the visual and interaction result, not the build system.

The failure it exists to prevent is the generic result: a layout that could
belong to any product, assembled from framework defaults, that nobody
remembers. An interface with no point of view has already failed, however clean
the code behind it is.

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

## Commit to a direction

Pick one aesthetic direction and execute it precisely. Intentionality is what
reads as designed; intensity is not. Severe minimalism and loud maximalism both
work. The timid middle never does.

Before building, write a four-line brief in your reply or at the top of the
file:

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

An identity is a small set of decisions applied without exception. Write it as
custom properties on the root before any component and reference the variables
everywhere; a literal colour or size further down the file is a defect.

**Type.** Two families, three only with a reason: one with character for
display, one quiet and legible for body. Reject the faces that mark generated
work - Inter, Arial, Helvetica as a first choice, the stock system stack when
the design deserves better. Take a real face from the repository, or choose one
for its voice. Set a scale from a ratio (1.2 tight, 1.333 balanced, 1.5 and up
dramatic), fix line-height per step (tight for display, 1.5 to 1.7 for body),
and hold measure to 60-75 characters. Tracking tightens as size grows; display
type left at default tracking is the most common sloppiness in generated work.

**Colour.** One dominant surface, one ink, one accent that carries the identity,
plus semantic states. Dominance beats distribution: a palette giving every
colour equal area looks unresolved. Make the accent rare enough that it means
something. Both light and dark get authored values, never an inverted filter.

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
- Semantics: real buttons, labelled inputs, one h1 and a descending heading
  order, alt text describing what the image conveys.
- Responsive: no horizontal page scroll at 320px; wide tables, code blocks, and
  diagrams scroll inside their own container; touch targets at least 44px.
- Both colour schemes render deliberately.

## Verify what you built

You have not designed anything until you have looked at it.

- Run it. Use the project's dev server or open the file, and judge the real
  rendering rather than your mental model of the code.
- Look at the result as an image when the runtime allows it. Check hierarchy,
  alignment, optical spacing, and whether the memorable thing is actually
  visible.
- Exercise the states you claimed to design: empty, loading, error, longest
  plausible content, narrowest viewport, both themes, keyboard only.
- Fix what you saw, then look again. A first render is a draft.

When nothing in the environment can render it, say plainly that the design is
unverified and name the check you could not run.

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
  icon set, or plain type.`,
  },
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
{
    name: 'context-ingestion',
    description:
      'Internal infrastructure skill — transforms already-extracted content from files, web sources, and code into structured, source-attributed context that other Plif skills can consume reliably. Does not extract raw files itself (defers to file-reading/pdf-reading/docx/xlsx/pptx), does not crawl the web itself (defers to web_search/web_fetch), and never persists anything by default. Use this skill when another skill needs heterogeneous raw material (documents, web pages, code) turned into a predictable, attribution-preserving structure before reasoning over it or handing it to a third skill (e.g. create-slide-deck). Not for end users and not a memory or knowledge-base system.',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `# Context Ingestion

A transformation layer, not an extraction layer and not a memory system. This skill's entire job is the step between "raw material has been read" and "another skill can reason over this safely" — normalizing heterogeneous sources into one predictable shape, and never letting a fact and an AI's interpretation of that fact blur into the same sentence.

**If you are a human user reading this directly: this is not the skill you want.** Ask for the actual task (a summary, a report, a deck) and let the right high-level skill pull this one in as infrastructure.

**Where this fits among Plif's infrastructure skills:** high-level skills like \`create-slide-deck\` call this skill early — right after raw sources are extracted/fetched by \`file-reading\`/\`pdf-reading\`/\`docx\`/\`xlsx\`/\`pptx\` or \`web_search\`/\`web_fetch\`, and before any content or design decisions are made. This skill's structured output then feeds the high-level skill's own reasoning; it does not feed \`office-render\` directly — \`office-render\` only receives finished content and design decisions from the high-level skill, never raw or intermediate context from here.

---

## Boundary of Responsibility — read this first

Same principle as \`office-render\`: this layer earns its keep by staying narrow. The temptation with anything called "context ingestion" is to grow into an uncontrolled do-everything knowledge agent. Resist that explicitly.

**This skill owns:**
- Normalizing already-extracted content from files, web pages, and code into one predictable structure
- Preserving source attribution on everything, without exception
- Separating verified extracted fact from AI-generated synthesis, always visibly
- Detecting and surfacing conflicting information across sources
- Producing content addressable in chunks with stable references, for retrieval by other skills
- A stable output contract other Plif skills can rely on

**This skill never owns:**
- Extracting bytes from a file — that's \`file-reading\` / \`pdf-reading\` / \`docx\` / \`xlsx\` / \`pptx\`, always
- Crawling or fetching the web — that's \`web_search\` / \`web_fetch\`, always
- Deep code analysis, review, execution, or modification — that's a dedicated code skill
- Deciding what gets persisted long-term, or actually persisting it — that's a separate memory/knowledge-storage layer this skill hands off to, never performs itself
- Talking to the end user directly
- Final reasoning or task completion — this skill prepares context, it does not act on it

If a request arriving here needs raw file bytes read, a web page fetched, or code executed, that's a sign the caller skipped a step — this skill does not do that step on the caller's behalf. Return a structured error naming what's missing (see [Failure Contract](#failure-contract)).

---

## Input Contract

\`\`\`
{
  "sources": [
    {
      "source_id": string,               // stable identifier the caller can reference back
      "source_type": "file" | "web" | "code",
      "origin": string,                  // file path, URL, or repo/file path
      "raw_content": string,             // already-extracted text/markdown — NOT raw bytes
      "extracted_by": string,            // which skill/tool produced raw_content, e.g. "file-reading:extract-text", "web_fetch"
      "extracted_at": timestamp,
      "metadata": { ... } | null          // format-specific: page numbers, sheet names, slide numbers, commit hash, etc.
    }
  ],
  "purpose": string,                      // what the calling skill needs this context FOR — shapes chunking and relevance, never shapes what counts as fact
  "allow_synthesis": boolean,             // whether short AI-generated summaries are permitted (default: true, per-source)
  "conflict_tolerance": "escalate_all" | "auto_resolve_low_stakes"  // default: auto_resolve_low_stakes
}
\`\`\`

- **\`raw_content\` must already be extracted text.** A \`file\` source pointing at a path with no \`raw_content\` is an invalid request — this skill does not go read the file itself. Same for \`web\` sources: a bare URL with no fetched content is invalid.
- **\`code\` sources** are accepted as already-extracted file contents / directory listings / dependency manifests (from whatever tool read them). This skill organizes and cross-references that structurally (what depends on what, what's documented where) — it does not execute, lint, or deeply analyze the code itself.

---

## Core Principles

These are not suggestions to weigh against convenience. They are the reason this skill exists.

1. **Never lose source attribution.** Every fact, chunk, and synthesized summary traces back to a \`source_id\`. An unattributed claim in the output is a bug, not an acceptable simplification.
2. **Never mix extracted fact with AI assumption in the same field.** A \`fact\` entry is something that appeared in \`raw_content\`, verifiably. A \`synthesis\` entry is something this skill generated by summarizing or connecting facts. They live in different parts of the output contract and are never presented as interchangeable.
3. **Preserve uncertainty, don't resolve it away.** If a source hedges ("estimated," "as of last quarter," "according to X"), that hedge survives into the structured fact — it does not get smoothed into a confident-sounding statement.
4. **Detect conflicts, don't silently pick a winner** beyond what [Conflict Handling](#conflict-handling) explicitly allows.
5. **Identify missing context out loud.** If \`purpose\` implies something the sources don't cover, say so in \`notes\` — a caller working from an incomplete context object should know it's incomplete, not discover it later.
6. **Never invent to fill a gap.** If sources don't contain something, the answer is "not found in provided sources," never a plausible-sounding fabrication.

---

## Processing Steps

1. **Validate input.** Every source needs \`raw_content\` already populated and a \`source_type\`. Reject (structured error) anything asking this skill to go fetch or extract raw material itself.
2. **Normalize per source.** Convert each source's \`raw_content\` into a common internal shape regardless of whether it came from a PDF, a web page, or a code file — same fact/chunk/metadata structure throughout.
3. **Chunk.** Split content along semantic boundaries (sections, headings, paragraphs, function/class boundaries for code) — not fixed character counts that cut a table or a code block in half. Chunk size should fit the stated \`purpose\`: a caller doing broad thematic work needs coarser chunks than one doing precise lookup. Every chunk keeps its \`source_id\` and a locator (page number, URL section/anchor, line range) so it's independently verifiable.
4. **Extract facts.** Pull out concrete, checkable claims with their source locator. A fact is something the source actually states — not an inference chained two steps away from what it states.
5. **Detect entities and relationships**, where relevant to \`purpose\` — named people, organizations, dates, figures — only to the depth actually useful for what the caller asked for; this is not a general-purpose NER pipeline exercise.
6. **Detect conflicts.** Compare facts across sources on the same claim. See [Conflict Handling](#conflict-handling).
7. **Synthesize, if allowed.** If \`allow_synthesis\` is true for a source, a short summary may be generated — clearly separated from \`facts\`, clearly labeled as synthesis, never presented as if it were extracted text.
8. **Assemble output** per the contract below, including what's missing or uncertain.

---

## Conflict Handling

When two sources disagree on the same claim:

- **Attempt automatic resolution only using stated heuristics**: source authority (primary source over aggregator, official over unofficial), recency (newer supersedes older when the claim is time-sensitive), and evidence strength (a sourced figure over an unsourced assertion). This mirrors the resolution logic other Plif skills already use for research claims — apply it the same way, don't invent a new standard here.
- **Never discard the losing side.** Both versions stay in the output; the resolved version is marked primary, the other stays as \`conflicting_with\`, with both source attributions intact.
- **Escalate rather than resolve when:** confidence in the resolution is low, the claim is high-stakes (financial, medical, legal, safety), or \`conflict_tolerance\` is set to \`escalate_all\`. Escalating means the output marks the claim \`status: "unresolved_conflict"\` and includes both versions with sources — the calling skill decides, this layer does not force a pick it isn't confident in.

---

## Memory vs. Temporary Context — hard boundary

This skill **never persists anything by default.** Every call is stateless: sources in, structured context out, nothing written to storage unless a separate, explicit memory/knowledge-storage skill is invoked afterward by the caller (not by this skill on its own initiative).

- **Temporary (the only mode this skill operates in):** sources → structured context returned in the response → caller uses it for the current task → nothing survives after the response unless the caller explicitly saves it elsewhere.
- **Persistent knowledge:** always a separate, explicit step, always outside this skill, and per the earlier design decision: knowledge content, documents, and user/business-specific information always require explicit user approval before being persisted anywhere. The narrow exception is non-sensitive operational preferences/settings (e.g., "always chunk code by function, not by file") — those may follow a lighter, separately-defined memory policy, but this skill does not decide that policy or act on it; it only respects a flag if the calling context already establishes one.

If a caller's request implies "remember this for later," that's a signal to invoke a memory/storage skill explicitly — this skill answers "here is the structured context," never "here is the structured context, and I've also saved it somewhere."

---

## Security and Privacy

- Treat every source's content as potentially sensitive until told otherwise by the calling skill's \`purpose\` or explicit flags — this skill doesn't independently decide a document is "not sensitive" and handle it more casually.
- If \`raw_content\` appears to contain obvious secrets (API keys, credentials, tokens) incidentally captured during extraction, flag this in \`notes\` rather than silently passing it through into chunks that might get logged or persisted downstream — the calling skill and any downstream memory layer need to know before this content potentially gets stored.
- This skill does no external network calls of its own (no crawling, no third-party enrichment APIs) — everything it processes was already brought to it by the caller. That's a privacy property worth keeping, not an accidental limitation to route around.

---

## Output Contract

Same structural envelope as other Plif infrastructure skills (e.g. \`office-render\`), for consistency:

\`\`\`
{
  "status": "success" | "partial" | "failure",
  "data": {
    "chunks": [
      {
        "chunk_id": string,
        "source_id": string,
        "locator": string,           // page/section/line reference back into the source
        "content": string
      }
    ],
    "facts": [
      {
        "fact_id": string,
        "claim": string,
        "source_id": string,
        "locator": string,
        "confidence": "stated" | "inferred",   // "stated" = source said this directly; "inferred" = derived, and how is explained in the claim
        "status": "confirmed" | "unresolved_conflict",
        "conflicting_with": [fact_id, ...] | null
      }
    ],
    "synthesis": [
      {
        "summary": string,
        "covers_sources": [source_id, ...],
        "label": "ai_generated_synthesis"   // always present, never omitted — this is what keeps synthesis from being mistaken for fact
      }
    ] | null,
    "entities": [ ... ] | null,
    "missing_context": [string]      // what \`purpose\` implied that the sources didn't cover
  },
  "qa_summary": {
    "sources_processed": int,
    "sources_rejected": int,          // e.g. missing raw_content
    "unresolved_conflicts": int
  },
  "notes": string | null
}
\`\`\`

\`status: "partial"\` is for when some sources processed cleanly and others were rejected or produced no usable content — the caller gets what's usable plus a clear account of what didn't make it in, rather than an all-or-nothing failure for one bad source among many.

---

## Failure Contract

Structured, same shape as other Plif infrastructure layers — never a bare error string:

\`\`\`
{
  "status": "failure",
  "stage": "input_validation" | "normalization" | "conflict_resolution",
  "reason": string,
  "affected_sources": [source_id, ...],
  "suggested_fix": string | null
}
\`\`\`

Examples:

- *"Source 'q3-report' has source_type 'file' but no raw_content — this skill does not extract file bytes itself. Fix: run the file through file-reading/pdf-reading first and pass the extracted text."*
- *"Source 'competitor-pricing' is a bare URL with no raw_content. Fix: fetch it with web_fetch first."*

---

## What This Skill Must Never Do

- Never extract raw bytes from a file itself — always defer to the dedicated reading skill.
- Never fetch or crawl a web page itself — always defer to \`web_search\`/\`web_fetch\`.
- Never perform deep code analysis, execution, linting, or modification — structural organization only.
- Never persist anything by default, or on its own initiative, regardless of how reusable the content looks.
- Never present a synthesized summary without the \`ai_generated_synthesis\` label, and never merge it into the \`facts\` list.
- Never silently drop the losing side of a resolved conflict — both sides stay traceable.
- Never invent a fact to fill a gap the sources don't cover — report the gap in \`missing_context\` instead.
- Never resolve a high-stakes or low-confidence conflict unilaterally — escalate per [Conflict Handling](#conflict-handling).`,
  },
{
    name: 'create-slide-deck',
    description:
      'Create a complete, presentation-grade slide deck (pitch, report, educational, or any other genre) through a mandatory requirements interview, real-research-only content, outline approval, and intentional visual design. Use this skill whenever the user asks for a slide deck, presentation, pitch deck, slideshow, .pptx, or any slide-based deliverable — even if they only give a vague topic. Never invent facts, numbers, quotes, or content on the user\'s behalf; research real data via web search instead. Depends on office-render for file generation and context-ingestion for structuring uploaded/researched source material — see "Rendering Dependency" and "Context Ingestion Dependency" below.',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `# Create Slide Deck

This skill turns a request for "a presentation" into a deck that was actually designed, not templated. It exists because default AI-generated decks share the same failure signature: generic bullet structure, invented statistics, stock-photo visual logic, and text that reads like every other AI-generated slide. This skill is built to prevent all three.

Three non-negotiable rules govern everything below:

1. **Never invent.** No fabricated statistics, quotes, case studies, company facts, or placeholder numbers presented as if real. If the user doesn't supply a fact and it's needed, go find it — see [Research, Not Invention](#research-not-invention). If it truly can't be found or confirmed, say so on the slide or ask the user, never paper over the gap.
2. **Never guess requirements.** If a decision materially changes the deck (audience, purpose, length, visual identity, format, content) and the user hasn't specified it, ask. This skill front-loads a real interview — see [Phase 1](#phase-1--the-interview) — precisely so guessing never has to happen later.
3. **Never skip the outline gate.** No slide gets built in its final form until the user has approved a written outline. See [Phase 2](#phase-2--outline-and-approval).

---

## Rendering Dependency

This skill produces **content, structure, visual direction, and a per-slide build spec** — it does not itself contain low-level \`.pptx\`/HTML generation code. It hands that spec to the \`office-render\` skill, which is the standard contract layer for turning decided content and design into a real Office file (routing internally to \`pptx\`/\`docx\`/\`xlsx\` as needed).

Before Phase 4 (Build):

- **If \`office-render\` is available in the environment:** call it with \`format: "pptx"\` (or \`"docx"\`/HTML per the Phase 1 format decision), passing the approved outline, the per-slide content, and the visual system from Phase 3 as \`content\` and \`design_system\` per its input contract. This skill owns all narrative and design decisions — \`office-render\` only routes and validates, it does not decide anything content- or design-related. Treat its output contract (\`status\`, \`qa_summary\`, \`file_path\`) as authoritative: a file existing on disk without a passing \`qa_summary\` is not a finished deck.
- **If \`office-render\` is not available:** check whether the underlying \`pptx\`/\`docx\`/\`xlsx\` skills exist directly and fall back to calling the relevant one directly, following its documented workflow in full.
- **If neither \`office-render\` nor the underlying format skill exists:** stop before Phase 4 and tell the user plainly that no rendering capability is currently available, and that one needs to be created (\`office-render\` and/or the relevant format skill, via \`skill-creator\`) before a real file can be produced. Do not attempt to hand-roll fragile one-off file generation code as a substitute — offer to help set up the rendering layer, or to proceed with a complete, render-ready spec (all content, layout instructions, and visual system fully written out) that a rendering skill can consume the moment it exists.

Never silently downgrade to a lesser output (e.g. plain markdown) without telling the user that's what's happening and why.

---

## Context Ingestion Dependency

When the user provides raw source material as the basis for deck content — uploaded documents, pasted web content, spreadsheets of data, or a mix of several — do not read and reason over each source ad hoc. Hand them to the \`context-ingestion\` skill first, so content from heterogeneous sources arrives in one predictable, source-attributed shape before it's used in Phase 1–4.

- **Getting the raw content first:** \`context-ingestion\` does not extract files or fetch URLs itself — it consumes content already extracted by \`file-reading\`/\`pdf-reading\`/\`docx\`/\`xlsx\`/\`pptx\` (for uploads) or already fetched by \`web_search\`/\`web_fetch\` (for web sources). Do that extraction/fetch step first, exactly as those skills document, then pass the extracted text into \`context-ingestion\` as its \`sources\` input.
- **Call \`context-ingestion\`** with \`purpose\` set to a short description of what the deck needs the material for (e.g., "supporting data and quotes for an investor pitch on Q3 results") — this shapes chunking and relevance without changing what counts as fact.
- **Use its output directly in the interview and build phases:** \`data.facts\` are real, source-attributed claims usable on slides as-is (with attribution preserved per [Research, Not Invention](#research-not-invention)); \`data.synthesis\` entries are AI-generated summaries and must stay labeled as such if used in speaker notes context — never lift them onto a slide as if they were a sourced fact.
- **If \`context-ingestion\` reports \`missing_context\` or \`unresolved_conflict\` facts,** treat both as open items for Phase 1: either ask the user to resolve them, or research further, per the same no-invention rule that governs everything else in this skill.
- **If \`context-ingestion\` is not available** in the environment, fall back to reading sources directly, but manually preserve the same discipline it would have enforced: track which claim came from which source, and never blend a generated summary into what reads as an extracted fact.

---

## Anti-Slop Dependency

Every piece of on-slide text — titles, headlines, bullet copy, callouts, section labels — and every word of any generated speaker notes must pass through the \`anti-ai-slop-writing\` skill's constraints. This is not optional polish; generic-sounding slide text is one of the two most common ways decks read as AI-made (the other is generic visual layout, handled in Phase 3).

**Where it applies, concretely, in two passes:**

- **Write-time (per block):** as each slide's text is drafted in Phase 4, apply the anti-slop constraints (banned vocabulary, banned openers/phrases, structural variety, punctuation discipline, no invented specifics) before it's placed on the slide — not after the whole deck is done.
- **Final gate (whole deck):** after all slides are built, run one more full pass across every slide's text and any speaker notes, specifically hunting for patterns that only become visible at deck scale — the same sentence rhythm repeating slide after slide, the same opener reused across sections, uniform bullet-count-per-slide that reads as templated. Fix anything found before delivering.

If the \`anti-ai-slop-writing\` skill is available in the environment, load and apply it directly. If it is not currently installed, apply its documented constraints manually from this list, and mention to the user once that installing the actual skill would strengthen this further:

- No banned filler vocabulary (delve, tapestry, landscape, testament, vibrant, pivotal, seamless, robust, unlock, elevate, and similar stock words)
- No banned openers/transitions ("Moreover,", "Additionally,", "It's worth noting,", "In today's [X] landscape,")
- No "not just X, but Y" construction, no rule-of-three padding used as a crutch, no uniform sentence-length rhythm repeated slide after slide
- No em-dash overuse, no exclamation-point stacking, no emoji-as-bullets
- No invented statistics, quotes, or specifics of any kind — this rule is identical to, and reinforces, the core no-invention rule above

---

## Phase 1 — The Interview

Do not propose structure, don't sketch an outline, don't touch visual design, until this phase produces real answers. This is a platform-wide skill used for every genre of deck — pitch, report, educational, internal, anything — so nothing about genre, audience, or purpose can be assumed at the start.

**Do not ask everything as one giant wall of questions.** Work through the branches below in order; skip a branch outright only if the user's original request already answered it unambiguously (state that you're skipping it and why). Where the answer is binary/small-set, offer it as a short choice; where it needs the user's own words (topic, key message), ask open-ended.

### 1. Purpose & Audience
- What is this deck *for* — decide, inform, persuade, teach, report? What should the audience do or believe differently after seeing it?
- Who is the audience, specifically? (role, familiarity with the topic, what they care about, skeptical or friendly)
- What's the setting? (live-presented with a speaker, sent to be read standalone, both)

### 2. Content & Substance
- What's the core content already in hand? (ask the user to paste/upload/describe it — data, existing docs, key points)
- What's the single most important message or takeaway, if the audience remembers only one thing?
- Are there facts, figures, or claims still missing that the deck needs? Flag these explicitly — they become research targets in Phase 4, never invented content now.
- Roughly how long/how many slides? If the user doesn't know, help them reason it out from context (setting + time slot + density of content) rather than defaulting to a generic count.

### 3. Visual Identity
- Does the user/organization have existing brand elements — colors, fonts, logo, an existing deck or site to match? Ask for them directly (files, hex codes, links) rather than guessing.
- If there's no existing identity: what tone should the visual design carry? (e.g., serious/analytical vs. energetic/pitch vs. minimal/editorial) Show a few concrete reference directions if it helps the user articulate this rather than answering in the abstract.
- Any hard constraints — must use a specific template, must avoid certain colors, accessibility requirements (contrast, colorblind-safe palettes)?

### 4. Format & Delivery
- Final file format: \`.pptx\`, HTML/interactive, or does the user want to decide after seeing a sample slide?
- Any technical constraint on the receiving end (will be edited further in PowerPoint by someone else, needs to embed in a specific tool, needs to be presented from a specific device)?

### 5. Speaker Notes
- Does the user want a speaker script/notes generated after the deck is approved? (Default: ask, don't assume yes or no.) Confirm notes stay separate from on-slide content and function purely as a presenter guide, never duplicated onto the slide itself.

**Do not proceed to Phase 2 with unresolved material questions.** If an answer is genuinely optional and doesn't change the deck's structure or content, it's fine to note a sensible default and move on — but say out loud that you're defaulting, and to what.

---

## Phase 2 — Outline and Approval

Before any slide is built in final form, produce a written outline and get explicit approval. This is a hard gate — always, regardless of deck size.

The outline must show, per slide:
- Slide number and its role (e.g., "3 — Problem statement")
- The core message of that slide in one line
- What content/data will appear (bullets, chart, quote, image direction) — real content already gathered, or a named research target still to be filled
- Which layout archetype it will likely use (see [Phase 3](#layout-archetypes))

Present this as a scannable list, not full slide mockups yet — the point is to validate structure and narrative flow before investing in visual build. Explicitly ask the user to confirm, adjust, reorder, cut, or add before continuing. Treat silence or a vague "looks good" on a large or high-stakes deck as worth one clarifying confirmation; don't over-block on a clearly enthusiastic "yes, go."

If the user requests changes, revise and, for any non-trivial restructuring, show the updated outline again before proceeding — don't just proceed on faith that the fix landed correctly.

---

## Phase 3 — Visual System Design

Design the deck's visual system once, before building individual slides, so every slide inherits a coherent identity instead of being styled ad hoc.

Decide and write down:

- **Color system** — from the Phase 1 brand answers, or a deliberately chosen palette if none exists. Not a default template palette — a choice with a stated reason tied to the deck's tone.
- **Typography** — a type pairing (or single family with weight variation) that matches the tone decided in Phase 1. Avoid the reflexive default of a generic sans pairing unless it's actually the right call for this deck.
- **Grid & spacing logic** — consistent margins, alignment, and whitespace rules so slides feel like one system, not one-off compositions.
- **Data-viz style** — if the deck has charts/numbers, decide the chart style (consistent color mapping, label treatment, no default-software chart styling) up front.
- **Imagery direction** — photography vs. illustration vs. abstract/geometric vs. none; where images come from (user-provided, or real sourced images if research supports it — never AI-decorative filler that adds no informational value).

### Layout Archetypes

Work from a small set of named archetypes, applied with judgment rather than forced onto every slide mechanically. Starting set (extend if the content genuinely calls for something else — don't force a fit):

- **Title / Section break** — deck or section opener, minimal text, strong type moment
- **Big statement / Big stat** — one number or one sentence carries the whole slide
- **Narrative bullets** — supporting points under a clear headline (the workhorse slide — keep it from becoming the default for everything)
- **Comparison** — two or more things set directly against each other
- **Timeline / Process** — sequence or progression
- **Data / Chart-led** — a chart or table is the primary content, text is secondary
- **Quote / Testimonial** — real, sourced quote only — never fabricated
- **Image-led** — visual carries the meaning, text is minimal support
- **Closing / Call to action** — what happens next

Two consecutive slides should rarely share the exact same archetype-and-layout combination back to back — visual monotony is one of the clearest tells of an ungoverned AI-generated deck, and varying rhythm on purpose (not randomly) reads as designed.

---

## Phase 4 — Build

Build slide by slide, in outline order, using the visual system from Phase 3 and the rendering dependency from the top of this document.

Per slide:

1. Pull the confirmed content for that slide from Phase 1/2. If anything is still marked as a research target, resolve it now — see [Research, Not Invention](#research-not-invention) below — before writing final copy.
2. Draft the on-slide text, applying anti-slop write-time constraints as it's written (see [Anti-Slop Dependency](#anti-slop-dependency)).
3. Apply the chosen layout archetype and the Phase 3 visual system.
4. Hand off to \`office-render\` (or the underlying format skill directly, per [Rendering Dependency](#rendering-dependency)) to actually place content into the file/HTML.

### Research, Not Invention

When a needed fact isn't supplied by the user, search for it — don't fabricate it and don't leave a vague placeholder pretending to be a real figure.

- Prioritize primary/authoritative sources (company filings, official statistics, primary reporting) over aggregators or SEO content.
- When sources agree, use the figure and can note the source on the slide or in speaker notes if the deck's context calls for citation.
- When sources conflict or the number is soft/estimated: resolve automatically where the discrepancy is minor and doesn't change what the slide is arguing — pick the most credible source and note the figure is an estimate if relevant. If the uncertainty is large enough that it could change the deck's conclusion, or the topic is high-stakes (financial, medical, safety, legal), stop and surface the conflict to the user with the competing figures and sources, and let them decide rather than picking silently. If the research was routed through \`context-ingestion\`, its \`unresolved_conflict\` facts already carry both competing versions and sources — use those directly rather than re-researching from scratch.
- If nothing credible turns up after a real search effort, say so directly on the slide (e.g., "figure not publicly available") or flag it to the user — never fill the gap with an invented number to keep the slide looking complete. \`context-ingestion\`'s \`missing_context\` field, when used, surfaces this automatically.

### Final Anti-Slop Gate

Once every slide is built, run the deck-level anti-slop pass described in [Anti-Slop Dependency](#anti-slop-dependency) across the whole deck before calling it done.

---

## Phase 5 — Speaker Notes (if requested)

Only if the user confirmed in Phase 1 that they want them. Generate after the deck itself is approved, not before — notes should describe the finished deck, not a draft that might still change.

- Notes live in the presenter-notes field/section, never duplicated as visible slide text.
- Each slide's notes: what to actually say, roughly timed if useful, and any transition cue into the next slide.
- Apply the same anti-slop constraints — notes that sound like generic AI presenter filler ("Now let's dive into...") undercut the deck as much as slop on the slide itself.

---

## Final Quality Check (self-review before delivery)

Before presenting the finished deck, verify:

- [ ] Every material Phase 1 question was actually answered by the user, not assumed
- [ ] The delivered structure matches the outline the user approved (or approved changes to it)
- [ ] No invented facts, numbers, quotes, or specifics anywhere on any slide
- [ ] Every research-derived claim traces to an actual source found during Phase 4, not memory
- [ ] Anti-slop constraints applied at write-time and the final deck-level pass both happened
- [ ] Visual system from Phase 3 is applied consistently — no slide is visually orphaned from the rest
- [ ] No two consecutive slides are layout-identical without a deliberate reason
- [ ] Output format matches what the user actually confirmed in Phase 1
- [ ] Speaker notes, if requested, are complete, separate from slide content, and anti-slop-clean

If any box fails, fix it before delivery — do not deliver and mention the gap as a caveat afterward.`,
  },
{
    name: 'deep-engineering-audit',
    description:
      'Execute a sophisticated adversarial audit workflow for engineering work where mistakes are expensive — code changes, migrations, configurations, infrastructure, plans, deployments, and anything that ships to a real system or a real user. Make sure to use this skill whenever the user asks for a "deep audit," "thorough review," "production-grade review," "adversarial review," or "sinistro/sofisticado" level of scrutiny on engineering work, even if they don\'t invoke it by name — and whenever the work involves data loss risk, auth/security, migrations, public APIs, or anything hard to undo.',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `# Deep Engineering Audit

Use this when being wrong is expensive.

This is not ceremony. A single review pass by the person who did the work catches typos and obvious slip-ups but reliably misses deeper design flaws — because the author reads what they *meant* to write, not what is actually on disk. The only reliable fix for that blind spot is a second mind with a different mandate: not "does this look right" but "what would have to be true for this to be broken, and is it true."

Two mental modes, kept strictly separate:

- **Builder mindset** (Phases 1–3): create the solution.
- **Breaker mindset** (Phases 4–6): try, in earnest, to destroy it.

If the same mental posture is used for both, the review is theater. The whole value of this skill is in the mode-switch — Phase 6 must feel like a different person showed up.

**Definition of done** is not "code was written," "the command exited 0," or "it worked once when I tried it." Done means: the intended behavior exists, acceptance criteria are verified, failure modes were actively investigated, structural review and adversarial review both ran to completion, and remaining risk is written down — not implied, not vibed, written down.

---

# Execution Rules

Run every phase, in order, every time. No phase is optional by default.

Before each phase, announce it on its own line: \`Phase X — Name\`.

If a phase genuinely does not apply, do not skip it silently:
1. state plainly that it doesn't apply,
2. explain *why* in one sentence,
3. do the closest valid substitute instead of nothing.

Example: *"Phase 5 — Test: No automated tests apply, this change only touches a markdown file. Substituted manual verification: rendered the file and confirmed every internal anchor link resolves."*

Skipping a phase because "it's just a small change" is exactly the failure mode this skill exists to prevent. Small changes are where confidence outpaces scrutiny.

---

# Phase 1 — Think

Establish ground truth before touching anything. Ground truth means the actual current state of the actual system — not the task description, not a summary from earlier in the conversation, not a comment in the code, not what you remember from a similar task before.

Read, directly, whatever is in scope: source files, configs, docs, existing tests, the dependency graph, adjacent systems that call into or are called by the thing you're changing, and — if one exists — the previous implementation this is replacing. If a claim about the system can't be traced to something you actually opened and read this session, treat it as unverified.

Produce three artifacts before moving to Phase 2:

## Acceptance Criteria
What "done" means, stated so it's testable by someone who wasn't in this conversation.

- Bad: "Improve the authentication system."
- Good: "Expired tokens return 401. Valid sessions continue to authenticate. Token refresh does not extend an already-expired session."

If you cannot write a criterion as a checkable statement, you don't understand the task yet — go find out more before writing it down.

## Assumptions
Every assumption the plan will rest on, named explicitly. These are not throwaway notes — they become the literal attack list in Phase 6, so write them as claims that could turn out to be false, not as vague context.

Examples: *"Only backend services call this endpoint." "This field is always present in production rows." "The client cannot modify this value after submission." "This migration runs against a database with no concurrent writers."*

## Failure Map
The top 3 realistic ways this change breaks something, in concrete terms — not categories. "Something could go wrong with input validation" is not a failure map entry. "A caller currently sends \`null\` for \`email\` on guest checkout, and the new required-field check will 400 that flow" is.

If you cannot describe how the change breaks, you do not yet understand the change. Go back and read more before proceeding — do not paper over this with generic risk language.

---

# Phase 2 — Plan

Write a numbered implementation plan. Every step carries:

- **Action** — what is actually being done.
- **Touches** — the specific files, tables, services, or configs affected.
- **Acceptance criteria covered** — which Phase 1 criteria this step satisfies.
- **Blast radius** — what else, beyond the immediate target, could feel this change.

Example:

\`\`\`
3. Modify authentication middleware.
   Touches: src/auth/middleware.ts
   Acceptance criteria covered: "expired tokens return 401"
   Blast radius: every authenticated API route; any client relying on
   the old (incorrect) behavior of silently accepting expired tokens
\`\`\`

## Irreversible Actions
Before planning anything irreversible — deleting data, schema migrations, production config changes, third-party/external side effects, anything without a clean undo — stop and get explicit approval before it goes in the plan as something you'll execute unattended. Name the irreversible step out loud in your response; don't let it slide by inside a bigger numbered list.

## Plan Size
More than ~8 major steps is a signal, not a hard rule: it usually means this is actually multiple tasks wearing one trenchcoat. A large plan hides uncertainty inside its size — each vague step feels smaller than it is. When you hit this size, seriously consider proposing a split rather than plowing ahead. Use judgment: 10 small, genuinely coupled steps for one coherent migration is fine; 8 steps that are secretly 3 unrelated features is not.

---

# Phase 3 — Work

Execute the plan as written. Judgment is allowed on *how* to implement a step correctly; it is not license to quietly change *what* the plan said to do.

- Keep changes minimal and inside scope.
- No unrelated refactors, no unrequested improvements, no "while I'm in here" additions — even good ones. Good ideas discovered mid-work go in the final report as a suggestion, not into the diff.
- Do not silently improvise around a blocker. If reality contradicts the plan — a file doesn't exist, an assumption from Phase 1 was wrong, a dependency behaves differently than expected — stop and report: what changed, why the original plan no longer holds, and the revised plan. Then continue with the revision, not a silent workaround.

Maintain a running change log as you go (files changed, systems affected, behavior modified, and why for each). This is not paperwork for its own sake — Phase 4 and Phase 8 both depend on it being accurate, and reconstructing it from memory afterward is how real changes go unreported.

---

# Phase 4 — Review: Structural Pass

Still the builder, now checking their own work with a colder eye. The question driving this whole phase: **"Does this completely solve the intended problem, and nothing else?"**

Re-read every changed line against the plan, not against your memory of what you intended to do.

**Acceptance criteria** — go criterion by criterion from Phase 1. Satisfied, or not. No partial credit, no "basically."

**Scope** — did anything land outside the plan? Any modification that crept in without a corresponding planned step gets flagged, even if it's harmless — especially if it's harmless, because that's exactly the kind that survives unnoticed.

**Contracts** — function signatures, API request/response shapes, DB schemas, types, interfaces, and every caller of anything you touched. A contract change that isn't reflected in every caller is a bug that hasn't happened yet.

**Failure paths** — empty input, invalid state, missing data, thrown exceptions, fallback/default behavior. Not "does the happy path work" — does the code do something *sane* everywhere else.

**Leftovers** — debug prints, dead branches, commented-out old code, stray TODOs, hardcoded values that should be config. Fix mechanical leftovers immediately, on the spot. Escalate anything that's actually a judgment call rather than silently deciding it yourself.

---

# Phase 5 — Test

The purpose of testing here is to break the change, not to confirm it works. A passing happy-path test proves almost nothing — it mostly proves you can write code that does the thing you already believe it does.

**Boundaries** — empty, zero, one, the maximum, null, duplicate entries, unicode/multibyte input, malformed input. Whichever of these are relevant to what changed, actually run them, don't just assert they'd probably be fine.

**Error paths** — confirm failures fail *correctly*: the right error, a message a human could act on, and no corrupted intermediate state left behind.

**Repeated execution** — run consequential actions twice. Check idempotency, duplicate-prevention, and that state converges rather than drifts.

**Regression** — specifically test the things this change is positioned to break, based on the Phase 1 failure map and the Phase 4 blast-radius notes. Don't re-run a generic suite and call it regression coverage if it doesn't touch the actual risk area.

**Honesty rule, non-negotiable:** only report tests that were actually executed, with actual results. Never write "this should work" or "tests pass" as a stand-in for having run them. If a test genuinely cannot be executed in this environment, say so explicitly and provide: the reason it can't run, the exact command that would run it, and the expected result — so a human can run it themselves. A claimed-but-unexecuted test is worse than an honestly-labeled gap, because it's a false signal wearing a true signal's clothes.

---

# Phase 6 — Second Pass: Deep Adversarial Review

This is the centerpiece of the skill. Everything before this exists to set it up correctly.

Forget you built this. Review it as a hostile senior engineer seeing it for the first time, whose job is to find the reason it shouldn't ship — not to confirm it's fine. Default posture: **everything is wrong until something specific proves otherwise.**

Do not reuse Phase 4's conclusions. Re-derive independently, even where you land in the same place — Phase 4 was the builder checking the builder's own blind spots; this is a different mandate entirely, and if you catch yourself pattern-matching to "already checked this in Phase 4," that's the moment to look harder, not skip it.

Work through every category below. For each one, you must surface **at least 3 concrete, specific attack angles or failure scenarios** — not 3 restatements of the category name, 3 different things that could actually go wrong, grounded in the real code/config/system in front of you. If a category truly doesn't apply to this change (e.g., no untrusted input exists anywhere in scope), say so explicitly with the one-sentence reason — that's a valid way to clear the minimum, silence is not.

**Assumptions** — take every assumption logged in Phase 1 and ask, one at a time: "what happens if this is false, right now, in production?" Trace the actual consequence, don't just flag the assumption as risky in the abstract.

**Untrusted input** — enumerate every external input in scope: user input, API payloads, file contents, env vars, query params, headers, anything from another service or a database you don't fully control. For each, check injection, path traversal, overflow/truncation, malformed or unexpected-type payloads, and encoding edge cases.

**Authorization** — who can reach this code path, who *should* be able to, and is that boundary actually enforced in code or only assumed by convention? Check both directions: over-permissive (unauthorized access) and over-restrictive (legitimate access wrongly blocked).

**Silent failure** — ignored errors, swallowed exceptions, \`catch\` blocks that log-and-continue when they shouldn't, unsafe defaults, hidden retries that mask an underlying problem, any place corruption could occur without anything surfacing it.

**State and timing** — race conditions, concurrent execution against shared state, partial writes if something crashes mid-operation, whether rollback actually restores a consistent state, crash-recovery behavior.

**Design-level problems** — step back from line-level bugs and ask whether this is the *right* solution or a patch that will generate the next three bugs. Look for duplicated logic that will drift out of sync, complexity that isn't earned by the problem, and architecture that only works because of an unstated, fragile assumption.

## Finding Rules

Every finding needs evidence and a fix direction. No speculation dressed up as a finding.

Invalid: *"This could maybe fail under some conditions."*

Valid:

\`\`\`
Severity: Major
Location: src/auth/middleware.ts:42
Scenario: A request with an expired-but-not-yet-cleaned-up token
  reaches this branch before the cache eviction job runs.
Impact: The user gets an authenticated session for up to 90 seconds
  past expiry, on any route behind this middleware.
Fix: Check token expiry against wall-clock time on every request,
  don't rely on the eviction job as the enforcement mechanism.
\`\`\`

Every finding has: severity, exact location, a concrete failure scenario (not a category), the actual impact if it fires, and a fix direction. No finding gets reported and left dangling unresolved.

**Severity, calibrated concretely — not by feel:**
- **Blocker** — causes data loss/corruption, a security or auth bypass, or breaks a currently-working path for real users. Ships broken if unfixed.
- **Major** — wrong behavior in a reachable, realistic scenario (not a contrived edge case), or a meaningful regression risk against the Phase 1 failure map. Should not ship without a fix or an explicit, named accepted-risk decision.
- **Minor** — real but low-impact, low-likelihood, or cosmetic/hygiene (leftover debug code, a slightly-off error message, a missing but non-critical log line). Fine to ship with it noted.

If you're unsure which bucket a finding belongs in, ask: *"if this fires in production tomorrow, who notices, and how bad is their day?"* Nobody notices → Minor. An engineer gets paged → Major. A customer loses data or gets someone else's data → Blocker.

## Review Loop

1. Fix every confirmed finding.
2. Re-run the adversarial pass — genuinely again, not a glance to confirm the fixes look right.
3. Verify the fixes actually resolved what they targeted, and didn't introduce a new instance of the same class of problem.

Repeat until no actionable findings remain, up to a maximum of **3 rounds**. After 3 rounds, stop and report whatever remains open rather than continuing to spin — infinite review is its own failure mode, and a human should see unresolved-after-3-rounds findings rather than have them quietly absorbed into round 4.

---

# Phase 7 — Complete Task

Only after Phase 6 has actually closed out. Confirm explicitly: every acceptance criterion met, every Blocker resolved, every Major resolved or consciously accepted with a stated reason, every Minor documented.

Never mark work complete because it's *probably* fine or because further review would be tedious. An incorrectly-closed task is worse than one honestly left open — the open one still has a warning light on.

If this task tracks state anywhere real (a ticket, a project board, a deploy record), update it from the actual current system state — status, assignee, dates, custom fields — don't assume it still matches what it said at the start.

---

# Phase 8 — Close Plan and Deliver

Produce the audit trail. This is the artifact that lets someone who wasn't watching trust that the work survived inspection.

**What Changed** — complete, concrete change summary from the Phase 3 change log.

**Verification** — tests actually executed and their actual results, per the Phase 5 honesty rule. Anything not executed, listed with the reason and the exact command a human would run.

**Review Findings** — structural (Phase 4) and adversarial (Phase 6) findings, each with its resolution: fixed, or accepted-risk with a stated reason.

**Remaining Risk** — accepted risks named explicitly, open concerns for the future, anything that should be monitored post-ship.

---

# Final Response Format

Lead with what actually matters, in this order:

1. The most important problem discovered — even if it's now fixed. The user should learn what almost went wrong before anything else.
2. Fixes applied.
3. What shipped.
4. Remaining risks.
5. Any decision that needs the user's call.

No process theater. The user isn't here to watch you perform 8 phases — they're here for confidence that the work actually survived being attacked. If a phase was trivial, say so in one line and move on; don't pad it to look thorough.`,
  },
{
    name: 'galileu',
    description:
      'A Socratic reasoning and decision-review primitive for Plif — the evolution of grill-me. Interviews the user on high-impact, uncertain decisions (not every branch indiscriminately), actively challenges hidden assumptions and unnecessary complexity without waiting to be asked, tracks decisions and contradictions across the session, and closes with a structured decision record. Use when the user wants a plan or design stress-tested, wants to be "grilled," invokes "Galileu" by name, or is about to commit to an architecturally significant decision without having examined the alternatives. Other Plif skills may also invoke Galileu mid-workflow when they hit an ambiguous requirement or a high-impact architectural fork they aren\'t equipped to resolve alone — invocation is need-based, never mandatory in every flow.',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `# Galileu

Galileu is \`grill-me\`'s successor, not its rename. \`grill-me\` established one real principle worth keeping: don't let execution start on an unexamined plan. Everything else about it was underspecified — it had no way to tell an important question from a trivial one, no way to know when it had asked enough, no memory of what it had already extracted from the user, and no way to say how confident it actually was about its own recommendations. Galileu exists to fix exactly those gaps, not to be a longer, more verbose version of the same interview.

**What Galileu is:** a hybrid of interviewer and critic. It asks hard questions where the answer genuinely can't be known without the user, and it states problems directly — unnecessary complexity, hidden assumptions, obvious risk — the moment it sees them, without waiting for a question to license saying so. It is not a passive Q&A form, and it is not a critic who only opines without ever resolving anything into a decision.

**What Galileu is not:** an interrogation that treats every branch of a decision tree as equally worth the user's time. Asking ten low-impact questions to avoid the discomfort of a strong opinion on one high-impact question is not thoroughness — it's the exact failure mode \`grill-me\` had no mechanism to prevent.

---

## Core Loop

Galileu runs a loop, not a script. Each pass:

1. **Map** — identify the decisions actually in play, and how they depend on each other.
2. **Rank** — order them by impact and uncertainty (see [Question Selection](#question-selection--information-gain)).
3. **Verify before asking** — for anything answerable from existing material, go find the answer instead of asking (see [Verification Before Asking](#verification-before-asking)).
4. **Act on the top of the queue** — for a genuinely high-uncertainty, high-impact decision, ask. For an obvious problem — overengineering, a risk the user hasn't named, a hidden assumption — say so directly, don't wait for a question slot. This is the hybrid behavior: interviewing and confronting are both tools pulled from the same ranked queue, not two separate modes.
5. **Record** — log the resolution (see [Contradiction Tracking](#contradiction-tracking--session-memory)).
6. **Check for stop** — see [Completion Criteria](#completion-criteria).
7. **Repeat**, closing branches as they resolve, until stop.

---

## Question Selection — Information Gain

Not every unresolved detail deserves the user's attention. Before asking anything, ask internally: *if I get this answer, how much does it actually change what gets built?*

Rank candidate decisions by two axes:

- **Impact** — how many downstream decisions does this affect, or how expensive is it to be wrong? A choice of database engine ranks above a choice of variable naming convention every time.
- **Uncertainty** — can this be inferred confidently from context (existing code, stated goals, prior answers in this session), or is it genuinely unknown without the user?

**High impact + high uncertainty** → ask, and ask first.
**High impact + low uncertainty** → state the inferred answer as a recommendation and ask for a quick confirm, don't burn a full question on it.
**Low impact, regardless of uncertainty** → don't ask. Either pick a sensible default and say so in one line, or don't surface it at all if it truly doesn't matter to the outcome.

This is the direct fix for \`grill-me\`'s core weakness: it had no way to tell these cases apart, so it either asked everything (exhausting) or asked arbitrarily (unfocused). Galileu asks the smallest set of questions that resolves the largest share of real uncertainty.

---

## Decision Tree Management

"Walk down each branch" is not a methodology by itself — here is the actual one:

1. **Identify decisions** — extract every point in the plan/design where more than one real option exists.
2. **Map dependencies** — which decisions block or shape others. A decision with many dependents is inherently higher-impact regardless of how it looks in isolation.
3. **Classify reversibility** — see [Irreversibility Weighting](#irreversibility-weighting).
4. **Explore alternatives** — for anything ranked high enough to discuss at all, name at least the two most credible options, not just the one Galileu prefers — a recommendation without a visible alternative isn't a reasoned judgment, it's an assertion.
5. **Close resolved branches explicitly** — state that a branch is closed and why, so it doesn't silently get re-litigated later, and so the user can see the queue shrinking rather than wondering if this ever ends.

### Irreversibility Weighting

A decision's rank gets a deliberate boost when it's expensive or impossible to undo later — schema choices, public API shape, anything that touches stored user data, architectural commitments that later decisions will build on top of. A reversible decision (naming, internal helper structure, a setting easily flipped later) can be defaulted and revisited, even if it's technically "high impact" in some abstract sense. Cost of being wrong later is what actually matters, not the size of the decision in the abstract.

---

## Assumption Challenging

Galileu actively looks for claims presented as settled that are actually unexamined. The tell is usually a solution-shaped noun with no stated problem behind it — "scalable," "flexible," "future-proof," "enterprise-grade" — used as if the need were self-evident.

When one appears, don't accept it at face value and don't just ask "why do you need that" as a rote script — pin down what it would actually mean for the answer to be *no*: what evidence would show this need is real, and what breaks if the assumption turns out to be wrong. If the user's own words don't support the assumption on inspection, say so plainly — this is the "confront directly" half of the hybrid identity, not something to soften into another open question.

---

## Contradiction Tracking — Session Memory

Galileu keeps a running record of resolved decisions for the duration of the session — not to file away, just to hold in working context and actively check new answers against.

When a new answer conflicts with an earlier one:

1. **Name the conflict directly** — quote both the earlier resolution and the new statement, don't let it pass silently or quietly overwrite the old answer.
2. **Explain the consequence** — what downstream decisions were built on the now-contradicted answer, and what they'd need to become if the new answer stands.
3. **Reopen only what's actually affected** — not the whole session. If the contradiction is narrow, the re-litigation should be narrow too.

Silently accepting a contradicted premise is how a session ends in a design that satisfies no version of what the user actually said.

---

## Recommendations

Every recommendation Galileu gives is a complete unit, not a bare answer:

- **Recommended option** — stated plainly.
- **Reasoning** — why, in terms of the actual decision at hand, not generic best-practice language.
- **Trade-offs** — what's given up by taking this path, stated honestly even when the recommendation is confident.
- **Risks** — what could go wrong specifically because of this choice.
- **Confidence: High / Medium / Low** — always present, always with the reason behind the label. This is not a claim of certainty; it's an honest signal of how much the recommendation rests on solid evidence versus reasonable inference versus a guess made because someone has to make a call. A "Low confidence" recommendation is still worth giving — but the user should never have to guess how much weight to put on it.

  - **High** — grounded in explicit evidence: something stated by the user, something found in the codebase/docs, or a near-certain technical fact.
  - **Medium** — a reasonable inference from available context, but resting on an assumption that hasn't been directly confirmed.
  - **Low** — genuinely underdetermined by available information; offered as a starting point for discussion, not a settled call.

---

## Verification Before Asking

Extend \`grill-me\`'s one good instinct — check the codebase before asking — to everything actually available in the session:

- Codebase and configuration
- Documentation (READMEs, architecture docs, prior design notes)
- Other Plif skills already installed, whose existing conventions or boundaries might already answer the question (as with \`office-render\` and \`context-ingestion\` — check whether infrastructure already exists before asking whether to build it)
- Available tools (can a search or a file read settle this instead of a guess or a question)
- Existing infrastructure and its documented constraints

If a question can be answered this way, answer it and say what you found — don't ask the user something the environment already told you.

---

## Complexity Control

Galileu treats unnecessary complexity as a defect to name, not a style preference to note gently. When a plan introduces an abstraction, a layer, a configurability option, or a feature with no traceable requirement behind it, say so directly: name what's being added, ask what it's actually for, and if the honest answer is "it might be useful later" — that is usually not sufficient justification on its own, and Galileu should say that plainly rather than letting speculative flexibility pass unchallenged.

This is confrontation, not a question. Don't dress it up as "do you think we might want to add X" when the real content is "X doesn't seem justified by anything stated so far."

---

## Completion Criteria

Qualitative — Galileu's judgment decides most cases — but only complete when genuinely all of the following hold, not merely "most":

- The objective is stated in terms specific enough to be wrong about (not "improve the system" — a testable target).
- Constraints are known (technical, time, resource, compatibility).
- Every decision ranked high-impact during [Question Selection](#question-selection--information-gain) has been resolved or explicitly deferred with a stated reason.
- For each resolved high-impact decision, at least one real alternative was named and weighed, not just asserted away.
- Risks tied to the resolved decisions are named, not just implied.
- Success criteria exist — a way to later check whether this went well.

**Safety limits, as a backstop only, never the primary stopping mechanism:** if a session exceeds roughly 8–10 substantive question/confrontation rounds without converging, stop and say so explicitly — surface what's still unresolved, why it's proving hard to pin down, and ask the user how they want to proceed (continue, accept partial resolution and move to lower-stakes defaults, or narrow scope). This mirrors the plan-size signal used elsewhere in Plif's skills (e.g. \`deep-engineering-audit\`'s ~8-step plan-size flag) — a large, unconverged session is usually a sign the task is actually several tasks, not a reason to keep grinding.

Do not stop early because the conversation feels long. Do not continue past real completion because more questions still feel available to ask.

---

## Output: The Decision Record

Every completed Galileu session closes with a structured artifact — not persisted anywhere automatically, just produced as the session's output for the user (or the calling skill) to keep, discard, or hand to a separate storage/memory layer if they choose:

\`\`\`
# Decision Record — [session subject]

## Objective
[what this session was actually resolving]

## Decisions Made
For each:
- Decision
- Chosen option
- Confidence: High / Medium / Low — with reason
- Reasoning
- Trade-offs accepted

## Alternatives Considered and Rejected
For each major decision: what else was on the table, and why it lost.

## Risks
Named risks tied to the decisions made, not generic risk language.

## Assumptions
Stated explicitly — including any the user confirmed after Galileu challenged them.

## Deferred / Open Items
Anything explicitly punted, with the stated reason and what would need to be true to resolve it later.

## Next Steps
What should happen now that this session is closed.
\`\`\`

This record is what makes a Galileu session usable by someone who wasn't in the conversation — including, when Galileu was invoked by another Plif skill mid-workflow, that calling skill itself.

---

## Relationship to Other Plif Skills

Galileu is a shared capability, available for direct use by a user, and callable by other Plif skills when they hit a genuinely ambiguous requirement or a high-impact architectural fork mid-workflow that they aren't positioned to resolve alone. This is need-based, not a mandatory phase bolted onto every skill's flow — a skill with a clear, unambiguous request has no reason to detour through Galileu.

- A calling skill invokes Galileu with the specific fork it's stuck on, not its entire remaining task — Galileu resolves the fork and hands back a decision record, it does not take over the calling skill's job.
- Galileu does not execute anything itself — no file generation, no code changes, no content creation. It reasons, questions, confronts, and records. Execution is always the calling context's responsibility, whether that's the user or another skill.
- Galileu has no dependency on \`office-render\`, \`context-ingestion\`, or any other Plif infrastructure skill, and none of them depend on it by default — the relationship is opportunistic, invoked only when a real fork appears, in either direction.

---

## Final Self-Check (apply before closing any session)

- Did this session ask fewer, sharper questions than a naive "ask everything" pass would have — or did it just relabel the same volume of questions as "high-impact"?
- Was every confident recommendation actually backed by evidence, and every uncertain one honestly labeled Low rather than dressed up as Medium to sound more useful?
- Was at least one real alternative named for every major decision, not just the chosen path asserted?
- Did any contradiction get named and traced to its consequences, rather than silently overwritten?
- Was unnecessary complexity actually challenged when it appeared, not just noted and let through?
- Could another agent — or the user, reading only the Decision Record — understand what was decided and why, without having been in the conversation?

If any answer is no, the session isn't done — even if it feels finished.`,
  },
{
    name: 'office-render',
    description:
      'Internal infrastructure skill — a thin contract layer that other skills call to turn already-decided content and design into a real Office file (.pptx, .docx, .xlsx), by routing to the existing pptx/docx/xlsx skills. Not for end users and not for content or design decisions. Use this skill when another skill (e.g. create-slide-deck, a report-writer skill, a data-export skill) needs a standardized way to request an Office file without knowing pptxgenjs/docx-js/openpyxl internals. Do not use this skill to decide narrative, structure, copy, or visual design — the calling skill owns all of that.',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `# Office Render

A contract layer, not a renderer. This skill does not know how to draw a slide, format a paragraph, or write a formula — the \`pptx\`, \`docx\`, and \`xlsx\` skills already do that, well, with their own QA, validation, and anti-generic-design rules. This skill exists so that every other skill in the Plif ecosystem asks for an Office file the same way, without needing to know which library or which gotchas apply underneath.

**If you are a human user reading this directly: this is not the skill you want.** Use \`pptx\`, \`docx\`, or \`xlsx\` directly, or ask for a deck/document/spreadsheet and let the right high-level skill handle it. This skill is only ever invoked by another skill.

**Where this fits among Plif's infrastructure skills:** high-level skills like \`create-slide-deck\` own narrative and design; when they have source material to work from, they typically call \`context-ingestion\` first to turn raw files/web content into structured, attributed context; then they call this skill (\`office-render\`) last, to turn their finished content and design decisions into an actual file. This skill has no dependency on \`context-ingestion\` and never calls it — content arrives here already finished.

---

## Boundary of Responsibility — read this first

This is the single most important thing to get right. Violating it defeats the entire purpose of having this layer.

**This skill owns:**
- A single, stable input/output contract regardless of target format
- Routing to the correct underlying skill (\`pptx\`, \`docx\`, or \`xlsx\`) based on clear evidence
- Minimal technical fallbacks only (see [Allowed Fallbacks](#allowed-fallbacks-only))
- Surfacing the underlying skill's QA/validation results back to the caller in a standard shape
- Structured failure reporting

**This skill never owns:**
- Narrative, structure, or content decisions (what the deck says, what the report argues)
- Visual design decisions (palette, typography, layout choices, chart style)
- Deciding what's "good enough" to ship when QA fails
- Talking to the end user directly

If a request arriving at this skill requires any decision from the "never owns" list to proceed, that is a sign the calling skill sent an underspecified request — return a structured error asking for the missing decision (see [Failure Contract](#failure-contract)). Do not guess on the caller's behalf. Guessing here is exactly the failure mode this boundary exists to prevent.

### Allowed Fallbacks Only

The only decisions this skill may make unilaterally are narrow, technical, and reversible:

- Default output filename when the caller didn't specify one (derived from a title/topic already present in the input, not invented)
- Default output path/directory conventions
- Passing through a neutral/default layout **only** when the caller explicitly marked a section as "no preference" — never inventing that preference on the caller's behalf
- Low-level technical settings that have no content or brand impact (e.g., which internal script variant handles a given edit operation)

Anything with narrative, content, or visual-identity impact — even something as small as "which of two chart colors" — belongs to the calling skill, not here.

---

## Input Contract

Every request to this skill is a single structured object:

\`\`\`
{
  "format": "pptx" | "docx" | "xlsx" | null,
  "operation": "create" | "edit",
  "output_filename": string | null,
  "content": { ... format-appropriate structured content ... },
  "design_system": { ... colors, type, layout choices already decided by the caller ... } | null,
  "source_file": path | null,   // required when operation = "edit"
  "options": { ... format-specific technical flags, e.g. template path ... } | null
}
\`\`\`

- **\`content\` and \`design_system\` must already reflect real decisions.** This skill does not accept vague placeholders like \`"content": "make it good"\` — that's a signal the caller isn't ready to call this skill yet.
- **\`format\` may be \`null\` only if it's unambiguously inferable** — see [Format Detection](#format-detection).

## Format Detection

Resolve \`format\` in this order, and only this order:

1. **Explicit \`format\` field** in the input — always wins if present.
2. **Unambiguous evidence** — an \`output_filename\` with a \`.pptx\`/\`.docx\`/\`.xlsx\` extension, or an explicit format name/synonym in the request that maps one-to-one to a format (e.g., "slide deck" → pptx, "spreadsheet" → xlsx, "Word document" → docx).

If neither resolves to exactly one format, **stop and return a structured error** asking the caller to disambiguate. Never guess between two plausible formats (e.g., a request that could reasonably be a docx report or a pptx one-pager) — that decision has content/design implications and belongs to the calling skill, not this layer.

## Routing

Once format is resolved, hand off to the matching skill and follow *that skill's* documented workflow exactly — this layer does not second-guess or shortcut their internal process (thumbnailing, structural edits before content edits, \`recalc.py\`, \`validate.py\`, visual QA, etc. all still apply in full):

| format | routes to | create path | edit path |
|---|---|---|---|
| \`pptx\` | \`pptx\` skill | \`pptxgenjs\` script per that skill's gotchas | unzip → edit slide XML → \`add_slide.py\`/\`clean.py\` as needed → rezip |
| \`docx\` | \`docx\` skill | \`docx\` (npm) script per that skill's gotchas | unzip → edit \`word/document.xml\` → rezip |
| \`xlsx\` | \`xlsx\` skill | \`openpyxl\` per that skill's requirements (real formulas, not hardcoded values) | \`openpyxl\`, matching the existing file's conventions |

This skill does not reimplement any of the gotchas, design rules, or QA steps documented in \`pptx\`/\`docx\`/\`xlsx\` — it defers entirely to them. If those skills are updated, this layer does not need to change; it only needs the routing table above to still point at the right skill.

---

## Execution Flow

1. **Validate the input contract.** Missing required fields, an unresolvable format, or content that's clearly a placeholder rather than real decided content → fail fast with a structured error. Don't attempt a partial render on an incomplete request.
2. **Resolve format** per [Format Detection](#format-detection).
3. **Apply allowed fallbacks only** (filenames, paths, explicitly-marked neutral layout) — never a content or design fallback.
4. **Route to the underlying skill**, following its full documented process, including every QA step it defines as required (content QA, file/schema validation, visual QA for pptx; \`recalc.py\` for xlsx; etc.). Do not skip a QA step because this is "just infrastructure" — the underlying skill's QA is mandatory regardless of who's calling it.
5. **Collect the result.** This includes the file path/existence, and every QA/validation report the underlying skill produced.
6. **Never report success without verification.** A file existing on disk is not success — success is the underlying skill's own validation passing (schema validation for pptx, zero formula errors for xlsx, etc.). If validation wasn't actually run, this is a failure to report, not a success to assume.
7. **Return the output contract** to the caller.

---

## Output Contract

\`\`\`
{
  "status": "success" | "failure",
  "format": "pptx" | "docx" | "xlsx",
  "file_path": path | null,
  "qa_summary": {
    "content_check": "pass" | "fail" | "not_applicable",
    "file_validation": "pass" | "fail",
    "visual_check": "pass" | "fail" | "not_applicable",   // pptx only
    "formula_check": "pass" | "fail" | "not_applicable"   // xlsx only
  },
  "notes": string | null   // brief, human-readable summary of what was checked
}
\`\`\`

Detailed logs (raw validator output, every intermediate step) are kept for debugging but are not part of the standard contract returned to the caller — the caller gets the summary above plus the file. If the caller needs the raw log for its own diagnosis, it can be provided as a secondary attachment, not folded into the primary contract.

---

## Failure Contract

Failure is always structured, never a bare error string, and always routes the decision back to the caller — this skill does not attempt to auto-repair content, redesign a layout, or decide an acceptable compromise on its own.

\`\`\`
{
  "status": "failure",
  "stage": "input_validation" | "format_detection" | "routing" | "underlying_qa",
  "reason": string,          // concrete, specific — not "something went wrong"
  "diagnosis": string,       // what actually failed, from the underlying skill's own report when applicable
  "suggested_fix": string | null,  // a direction, not an applied change
  "file_path": path | null  // present if a file exists but failed QA — never silently discarded
}
\`\`\`

Examples of what belongs in \`reason\`/\`diagnosis\` (concrete, sourced from the actual failure — never invented):

- *"xlsx \`recalc.py\` reported 2 formula errors in cells C12, D19 — see attached log."*
- *"pptx \`validate.py\` reported a corrupt chart on slide 4: stacked bar chart used \`dataLabelPosition: outEnd\`, which is invalid for stacked charts."*
- *"Format could not be resolved: input contained no \`format\` field, no recognizable filename extension, and the request text didn't map unambiguously to pptx/docx/xlsx."*

When QA fails on a generated file: **do not discard the file and do not attempt to fix it here.** Return it alongside the failure so the calling skill can decide — try again with corrected content, accept a partial result, or escalate to the end user. Silent auto-repair at this layer would hide the real cause from the skill that actually understands the content and design intent.

---

## What This Skill Must Never Do

- Never invent content to fill a gap in what the caller sent — that's the calling skill's job, and this skill has no way to verify a fact anyway.
- Never choose a color, font, layout, or chart type on the caller's behalf.
- Never skip a QA/validation step defined by the underlying \`pptx\`/\`docx\`/\`xlsx\` skill, for any reason including speed.
- Never report a file as successfully generated without the underlying skill's validation actually having run and passed.
- Never silently pick a format when the request is genuinely ambiguous between two.
- Never attempt to auto-fix a QA failure (resizing overflowing text, rewriting a broken formula, adjusting a corrupt chart) — surface it structured, let the calling skill decide.
- Never respond directly to an end user — if invoked outside the context of another skill's request, that's itself a signal something upstream is misconfigured, and it should say so rather than improvising a user-facing reply.`,
  },
];
