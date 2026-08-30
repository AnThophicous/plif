import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
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
  /** Package-relative executable bundled with Plif as a final fallback. */
  readonly bundledModule?: string;
}

const require = createRequire(import.meta.url);

export const SERVERS: readonly ServerSpec[] = [
  {
    id: 'json',
    label: 'JSON / JSONC',
    languageIds: ['json', 'jsonc'],
    extensions: ['.json', '.jsonc'],
    markers: [],
    bin: 'vscode-json-language-server',
    args: ['--stdio'],
    install: 'npm i -g vscode-langservers-extracted',
    bundledModule: 'vscode-langservers-extracted/bin/vscode-json-language-server',
    initializationOptions: { provideFormatter: true },
  },
  {
    id: 'html',
    label: 'HTML',
    languageIds: ['html'],
    extensions: ['.html', '.htm'],
    markers: [],
    bin: 'vscode-html-language-server',
    args: ['--stdio'],
    install: 'npm i -g vscode-langservers-extracted',
    bundledModule: 'vscode-langservers-extracted/bin/vscode-html-language-server',
  },
  {
    id: 'css',
    label: 'CSS / SCSS / Less',
    languageIds: ['css', 'scss', 'less'],
    extensions: ['.css', '.scss', '.less'],
    markers: [],
    bin: 'vscode-css-language-server',
    args: ['--stdio'],
    install: 'npm i -g vscode-langservers-extracted',
    bundledModule: 'vscode-langservers-extracted/bin/vscode-css-language-server',
  },
  {
    id: 'bash',
    label: 'Bash / Shell',
    languageIds: ['shellscript'],
    extensions: ['.sh', '.bash', '.zsh'],
    markers: ['.shellcheckrc'],
    bin: 'bash-language-server',
    args: ['start'],
    install: 'npm i -g bash-language-server',
  },
  {
    id: 'powershell',
    label: 'PowerShell Editor Services',
    languageIds: ['powershell'],
    extensions: ['.ps1', '.psm1', '.psd1'],
    markers: [],
    bin: 'pwsh',
    args: [],
    install: 'install the VS Code PowerShell extension or set PLIF_POWERSHELL_EDITOR_SERVICES to Start-EditorServices.ps1',
  },
  {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    markers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    bin: 'typescript-language-server',
    args: ['--stdio'],
    install: 'npm i -D typescript-language-server typescript',
    bundledModule: 'typescript-language-server/lib/cli.mjs',
  },
  {
    id: 'toml',
    label: 'TOML',
    languageIds: ['toml'],
    extensions: ['.toml'],
    markers: ['Cargo.toml', 'pyproject.toml', 'config.toml'],
    bin: 'taplo',
    args: ['lsp', 'stdio'],
    install: 'install a Taplo CLI build with the lsp feature',
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
    '.sh': 'shellscript',
    '.bash': 'shellscript',
    '.zsh': 'shellscript',
    '.ps1': 'powershell',
    '.psm1': 'powershell',
    '.psd1': 'powershell',
    '.json': 'json',
    '.jsonc': 'jsonc',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.toml': 'toml',
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
  readonly source: 'project' | 'path' | 'bundled';
  /** `cmd.exe` needs the pre-quoted command line passed verbatim on Windows. */
  readonly windowsVerbatimArguments?: boolean;
}

export interface ResolveServerOptions {
  /**
   * Project-local executables are repository-controlled code and therefore
   * must never run on the host without an explicit trust decision.
   */
  readonly allowProjectExecutable?: boolean;
}

const WINDOWS_SUFFIXES = ['.cmd', '.exe', '.bat', ''];

export async function resolveServer(
  spec: ServerSpec,
  workspace: string,
  tempRoot?: string,
  options: ResolveServerOptions = {},
): Promise<ResolvedServer | null> {
  if (spec.id === 'powershell') return await resolvePowerShell(spec, tempRoot);

  // A package-relative script is the only Windows path that does not depend on
  // spawning an npm-generated `.cmd` shim (Node rejects that with EINVAL when
  // `shell` is correctly disabled). Invoke the script with this Node process.
  if (spec.bundledModule) {
    try {
      const script = require.resolve(spec.bundledModule);
      return {
        spec,
        command: process.execPath,
        args: [script, ...spec.args],
        source: 'bundled',
      };
    } catch {
      // Embedders may deliberately omit the optional package; continue to the
      // workspace and PATH discovery used by every other language server.
    }
  }
  const local = path.join(workspace, 'node_modules', '.bin', spec.bin);
  const suffixes = process.platform === 'win32' ? WINDOWS_SUFFIXES : [''];

  const allowProjectExecutable = options.allowProjectExecutable ??
    process.env['PLIF_ALLOW_PROJECT_LSP'] === '1';
  if (allowProjectExecutable) {
    for (const suffix of suffixes) {
      if (await exists(local + suffix)) {
        return spawnableServer(spec, local + suffix, spec.args, 'project');
      }
    }
  }

  const onPath = await findOnPath(spec.bin);
  if (onPath) return spawnableServer(spec, onPath, spec.args, 'path');

  return null;
}

function spawnableServer(
  spec: ServerSpec,
  command: string,
  args: readonly string[],
  source: ResolvedServer['source'],
): ResolvedServer {
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) {
    return { spec, command, args, source };
  }

  const comSpec = process.env['ComSpec'] ?? process.env['COMSPEC'] ?? 'cmd.exe';
  return {
    spec,
    command: comSpec,
    args: ['/d', '/s', '/c', ['call', quoteWindowsArgument(command), ...args.map(quoteWindowsArgument)].join(' ')],
    source,
    windowsVerbatimArguments: true,
  };
}

function quoteWindowsArgument(value: string): string {
  let result = '"';
  let backslashes = 0;

  for (const character of value) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += '\\'.repeat(backslashes) + character;
    backslashes = 0;
  }

  return result + '\\'.repeat(backslashes * 2) + '"';
}

async function resolvePowerShell(spec: ServerSpec, tempRoot?: string): Promise<ResolvedServer | null> {
  const executable = await findOnPath('pwsh');
  if (!executable) return null;
  const configured = process.env['PLIF_POWERSHELL_EDITOR_SERVICES'];
  const script = configured && await exists(configured) ? configured : await discoverPowerShellEditorServices();
  if (!script) return null;
  const bundled = path.dirname(path.dirname(script));
  const sessionDirectory = tempRoot
    ? path.join(path.resolve(tempRoot), 'lsp')
    : os.tmpdir();
  await fs.mkdir(sessionDirectory, { recursive: true });
  const session = path.join(sessionDirectory, `pses-${process.pid}.json`);
  return {
    spec,
    command: executable,
    args: [
      '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-HostName', 'Plif', '-HostProfileId', 'Plif', '-HostVersion', '0.1.0',
      '-BundledModulesPath', bundled, '-SessionDetailsPath', session, '-Stdio',
    ],
    source: 'path',
  };
}

async function discoverPowerShellEditorServices(): Promise<string | null> {
  const roots = [path.join(os.homedir(), '.vscode', 'extensions'), path.join(os.homedir(), '.vscode-insiders', 'extensions')];
  for (const root of roots) {
    let entries;
    try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
    const extensions = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('ms-vscode.powershell-')).sort().reverse();
    for (const extension of extensions) {
      const script = path.join(root, extension.name, 'modules', 'PowerShellEditorServices', 'Start-EditorServices.ps1');
      if (await exists(script)) return script;
    }
  }
  return null;
}

async function findOnPath(bin: string): Promise<string | null> {
  // Relative PATH entries (especially `.`) are controlled by the active
  // workspace. Ignore them so PATH lookup cannot silently reintroduce the
  // project-executable path that resolveServer denies by default.
  const entries = (process.env['PATH'] ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter((entry) => path.isAbsolute(entry));
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

  for (const spec of SERVERS) {
    if (!found.has(spec.id) && await hasExtension(workspace, spec.extensions, 3)) found.set(spec.id, spec);
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
