import fs from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PlifError } from '../errors.js';
import type { Message } from '../model/provider.js';
import type { Tool, ToolContext, ToolResult } from './tools.js';

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

export interface ParseSkillOptions {
  readonly loadInstructions?: boolean;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseSkill(
  source: string,
  file: string,
  scope: SkillScope,
  options: ParseSkillOptions = {},
): Skill | null {
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

  const packageId = fields.get('package');
  const packageName = fields.get('package-name');
  const skillPackage =
    scope === 'builtin' && packageId && packageName && NAME_PATTERN.test(packageId)
      ? { id: packageId, name: packageName }
      : undefined;

  return {
    name,
    description,
    scope,
    file,
    instructions: options.loadInstructions === false ? '' : (body ?? '').trim(),
    ...(skillPackage ? { package: skillPackage } : {}),
  };
}

async function readSkillsFrom(dir: string, scope: SkillScope): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  // Skill files are independent. Preserve readdir order in the result while
  // allowing NTFS/ext4 to service the reads concurrently during startup.
  const loaded = await Promise.all(entries.map(async (entry) => {
    const file = path.join(dir, entry, SKILL_FILE);
    try {
      const source = await fs.readFile(file, 'utf8');
      return parseSkill(source, file, scope);
    } catch {
      return null;
    }
  }));
  return loaded.filter((skill): skill is Skill => skill !== null);
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
  #sortedSkills: Skill[] | null = null;
  #catalogueCache: string | undefined;

  static async load(sources: SkillSources): Promise<SkillRegistry> {
    const registry = new SkillRegistry();
    registry.#sources = sources;

    const builtin = sources.builtin ?? BUILTIN_SKILLS;
    for (const skill of builtin) registry.#add(skill);
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
    this.#sortedSkills = null;
    this.#catalogueCache = undefined;
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
    return [...this.sortedSkills()];
  }

  get size(): number {
    return this.#skills.size;
  }

  catalogue(): string {
    if (this.#catalogueCache !== undefined) return this.#catalogueCache;
    if (this.#skills.size === 0) {
      this.#catalogueCache = '';
      return this.#catalogueCache;
    }
    const standalone: Skill[] = [];
    const packaged = new Map<string, { package: SkillPackage; skills: Skill[] }>();

    for (const skill of this.sortedSkills()) {
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
    this.#catalogueCache = sections.join('\n\n');
    return this.#catalogueCache;
  }

  private sortedSkills(): Skill[] {
    this.#sortedSkills ??= [...this.#skills.values()].sort((a, b) => a.name.localeCompare(b.name));
    return this.#sortedSkills;
  }
}

/** Skills that every provider and every effort must load before proceeding. */
export const MANDATORY_GLOBAL_SKILLS = ['anti-ai-slop', 'galileu'] as const;

/** Additional skills required by the PLIF effort. */
export const MANDATORY_PLIF_SKILLS = [
  ...MANDATORY_GLOBAL_SKILLS,
  'plif-cybersecurity',
] as const;

export function mandatorySkillsForEffort(effort?: string): readonly string[] {
  return effort === 'plif' ? MANDATORY_PLIF_SKILLS : MANDATORY_GLOBAL_SKILLS;
}

/**
 * Find successful mandatory skill loads already carried by the conversation.
 *
 * Skill bodies are intentionally kept in the current conversation so the model
 * can follow them on later turns. This only records which bodies are present;
 * it lets the PLIF prompt avoid calling the loader again and duplicating a
 * 28-KB result on every user message.
 */
export function loadedSkillNames(messages: readonly Message[]): readonly string[] {
  const calls = new Map<string, string>();
  const loaded = new Set<string>();

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        if (call.name !== 'skill') continue;
        try {
          const parsed = JSON.parse(call.arguments) as { name?: unknown };
          if (typeof parsed.name === 'string') calls.set(call.id, parsed.name);
        } catch {
          // Malformed calls are handled by the normal tool protocol; they do
          // not count as a loaded skill here.
        }
      }
      continue;
    }
    if (message.role !== 'tool' || !message.toolCallId) continue;
    const name = calls.get(message.toolCallId);
    if (!name || !MANDATORY_PLIF_SKILLS.includes(name as (typeof MANDATORY_PLIF_SKILLS)[number])) continue;
    if (message.content.includes(`# Skill: ${name}`)) loaded.add(name);
  }

  return MANDATORY_PLIF_SKILLS.filter((name) => loaded.has(name));
}

function builtinSkillDirectory(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDirectory, '../agenting/skills/builtin'),
    path.resolve(moduleDirectory, '../../src/agenting/skills/builtin'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function readBuiltinSkills(): Skill[] {
  const directory = builtinSkillDirectory();
  let entries: string[];
  try {
    entries = readdirSync(directory).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry, SKILL_FILE);
    try {
      const skill = parseSkill(readFileSync(file, 'utf8'), file, 'builtin', {
        loadInstructions: false,
      });
      if (!skill) continue;

      let instructions: string | undefined;
      skills.push({
        ...skill,
        get instructions() {
          if (instructions === undefined) {
            const loaded = parseSkill(readFileSync(file, 'utf8'), file, 'builtin');
            if (!loaded) throw new Error(`Builtin skill became invalid: ${skill.name}`);
            instructions = loaded.instructions;
          }
          return instructions!;
        },
      });
    } catch {
      // A missing or malformed optional skill must not prevent the CLI from
      // starting; the registry exposes the remaining valid skills.
    }
  }
  return skills;
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

export const BUILTIN_SKILLS: readonly Skill[] = readBuiltinSkills();
