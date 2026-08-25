import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  'pom.xml',
] as const;

export interface ProjectRootChoice {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export function normaliseProjectPath(value: string, cwd = process.cwd()): string {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  const expanded = trimmed === '~'
    ? os.homedir()
    : trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith('~/')
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed;
  return path.resolve(cwd, expanded);
}

export function projectRootChoices(cwd: string): readonly ProjectRootChoice[] {
  const home = os.homedir();
  return [
    { value: path.resolve(cwd), label: 'Current folder', description: path.resolve(cwd) },
    { value: path.join(home, 'Projects'), label: '~/Projects', description: 'default personal projects folder' },
    { value: path.join(home, 'Documents', 'Projects'), label: '~/Documents/Projects', description: 'projects under Documents' },
    { value: '__custom__', label: 'Choose another folder', description: 'type a path in the same PLIF input' },
  ];
}

/** A project folder is preserved even when a saved default exists elsewhere. */
export async function isProjectDirectory(directory: string): Promise<boolean> {
  let current = path.resolve(directory);
  while (true) {
    for (const marker of PROJECT_MARKERS) {
      try {
        await fs.access(path.join(current, marker));
        return true;
      } catch {
        // Try the next marker and then the parent.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** Resolve the workspace without surprising an explicit CLI choice. */
export async function resolveWorkspace(
  currentWorkspace: string,
  configuredProjectRoot: string | undefined,
  explicit = false,
): Promise<string> {
  const current = path.resolve(currentWorkspace);
  if (explicit || await isProjectDirectory(current) || !configuredProjectRoot) return current;
  // The saved location is user-owned configuration. Recreate it when it was
  // moved or deleted instead of silently falling back to the launch folder.
  return await ensureProjectRoot(configuredProjectRoot);
}

export async function ensureProjectRoot(value: string): Promise<string> {
  const target = normaliseProjectPath(value);
  await fs.mkdir(target, { recursive: true });
  const stat = await fs.stat(target);
  if (!stat.isDirectory()) throw new Error('the selected project location is not a directory');
  return fs.realpath(target);
}
