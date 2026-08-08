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

export class SkillRegistry {
  #skills = new Map<string, Skill>();

  static async load(sources: SkillSources): Promise<SkillRegistry> {
    const registry = new SkillRegistry();

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
    this.#skills.set(skill.name, skill);
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
