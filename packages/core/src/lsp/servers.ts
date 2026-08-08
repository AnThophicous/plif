import fs from 'node:fs/promises';
import path from 'node:path';

export interface ServerSpec {
  readonly id: string;
  readonly label: string;
  readonly languageIds: readonly string[];
  readonly extensions: readonly string[];
  readonly markers: readonly string[];
  readonly bin: string;
  readonly args: readonly string[];
  readonly install: string;
  readonly initializationOptions?: Record<string, unknown>;
}

export const SERVERS: readonly ServerSpec[] = [
  {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    markers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    bin: 'typescript-language-server',
    args: ['--stdio'],
    install: 'npm i -D typescript-language-server typescript',
  },
  {
    id: 'python',
    label: 'Python',
    languageIds: ['python'],
    extensions: ['.py', '.pyi'],
    markers: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'],
    bin: 'pyright-langserver',
    args: ['--stdio'],
    install: 'npm i -g pyright',
  },
  {
    id: 'rust',
    label: 'Rust',
    languageIds: ['rust'],
    extensions: ['.rs'],
    markers: ['Cargo.toml'],
    bin: 'rust-analyzer',
    args: [],
    install: 'rustup component add rust-analyzer',
  },
  {
    id: 'go',
    label: 'Go',
    languageIds: ['go'],
    extensions: ['.go'],
    markers: ['go.mod'],
    bin: 'gopls',
    args: [],
    install: 'go install golang.org/x/tools/gopls@latest',
  },
  {
    id: 'clangd',
    label: 'C / C++',
    languageIds: ['c', 'cpp'],
    extensions: ['.c', '.h', '.cc', '.cpp', '.hpp', '.cxx'],
    markers: ['compile_commands.json', 'CMakeLists.txt', 'Makefile'],
    bin: 'clangd',
    args: [],
    install: 'install clangd from your package manager',
  },
];

export function languageIdFor(file: string): string | null {
  const extension = path.extname(file).toLowerCase();
  const map: Readonly<Record<string, string>> = {
    '.ts': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'javascriptreact',
    '.py': 'python',
    '.pyi': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.c': 'c',
    '.h': 'c',
    '.cc': 'cpp',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.cxx': 'cpp',
  };
  return map[extension] ?? null;
}

export function serverFor(file: string): ServerSpec | null {
  const extension = path.extname(file).toLowerCase();
  return SERVERS.find((server) => server.extensions.includes(extension)) ?? null;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export interface ResolvedServer {
  readonly spec: ServerSpec;
  readonly command: string;
  readonly args: readonly string[];
  readonly source: 'project' | 'path';
}

const WINDOWS_SUFFIXES = ['.cmd', '.exe', '.bat', ''];

export async function resolveServer(
  spec: ServerSpec,
  workspace: string,
): Promise<ResolvedServer | null> {
  const local = path.join(workspace, 'node_modules', '.bin', spec.bin);
  const suffixes = process.platform === 'win32' ? WINDOWS_SUFFIXES : [''];

  for (const suffix of suffixes) {
    if (await exists(local + suffix)) {
      return { spec, command: local + suffix, args: spec.args, source: 'project' };
    }
  }

  const onPath = await findOnPath(spec.bin);
  if (onPath) return { spec, command: onPath, args: spec.args, source: 'path' };

  return null;
}

async function findOnPath(bin: string): Promise<string | null> {
  const entries = (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean);
  const suffixes =
    process.platform === 'win32'
      ? (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').map((s) => s.toLowerCase())
      : [''];

  for (const dir of entries) {
    for (const suffix of [...suffixes, '']) {
      const candidate = path.join(dir, bin + suffix);
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

export async function detectLanguages(workspace: string): Promise<ServerSpec[]> {
  const found = new Map<string, ServerSpec>();

  for (const spec of SERVERS) {
    for (const marker of spec.markers) {
      if (await exists(path.join(workspace, marker))) {
        found.set(spec.id, spec);
        break;
      }
    }
  }

  if (found.size === 0) {
    for (const spec of SERVERS) {
      if (await hasExtension(workspace, spec.extensions, 3)) found.set(spec.id, spec);
    }
  }

  return [...found.values()];
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.venv', '__pycache__']);

async function hasExtension(
  dir: string,
  extensions: readonly string[],
  depth: number,
): Promise<boolean> {
  if (depth < 0) return false;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) return true;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    if (await hasExtension(path.join(dir, entry.name), extensions, depth - 1)) return true;
  }
  return false;
}
