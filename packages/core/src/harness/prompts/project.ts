import fs from 'node:fs/promises';
import path from 'node:path';

const INSTRUCTION_FILENAMES = ['AGENTS.md', 'Agents.md', 'AGENT.md'] as const;

export interface ResolvedAgentInstruction {
  readonly path: string;
  readonly relativePath: string;
  readonly content: string;
}

export async function resolveAgentInstructions(
  workspace: string,
  target: string = workspace,
): Promise<readonly ResolvedAgentInstruction[]> {
  const root = path.resolve(workspace);
  const resolvedTarget = path.resolve(target);
  assertWithinWorkspace(root, resolvedTarget);
  const directory = await targetDirectory(resolvedTarget);
  assertWithinWorkspace(root, directory);

  const relative = path.relative(root, directory);
  const directories = [root];
  if (relative) {
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      directories.push(current);
    }
  }

  const instructions: ResolvedAgentInstruction[] = [];
  for (const candidateDirectory of directories) {
    const instruction = await readFirstInstruction(root, candidateDirectory);
    if (instruction) instructions.push(instruction);
  }
  return instructions;
}

export async function readAgentInstructions(
  workspace: string,
  target?: string,
): Promise<string | undefined> {
  const instructions = await resolveAgentInstructions(workspace, target ?? workspace);
  if (instructions.length === 0) return undefined;
  return instructions
    .map(
      (instruction) =>
        `Instruction source: ${instruction.relativePath}\n\n${instruction.content}`,
    )
    .join('\n\n');
}

async function readFirstInstruction(
  root: string,
  directory: string,
): Promise<ResolvedAgentInstruction | undefined> {
  for (const name of INSTRUCTION_FILENAMES) {
    const candidate = path.join(directory, name);
    try {
      const content = await fs.readFile(candidate, 'utf8');
      if (!content.trim()) continue;
      return {
        path: candidate,
        relativePath: path.relative(root, candidate) || name,
        content: content.trim(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return undefined;
}

async function targetDirectory(target: string): Promise<string> {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory() ? target : path.dirname(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return path.extname(target) ? path.dirname(target) : target;
  }
}

function assertWithinWorkspace(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === '') return;
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new RangeError(`Project instruction target is outside workspace: ${target}`);
  }
}
