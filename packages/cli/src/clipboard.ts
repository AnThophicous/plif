/**
 * Getting an image out of the system clipboard.
 *
 * A terminal has no drag-and-drop and no file dialog, so a screenshot the
 * developer just took is otherwise unreachable: they would have to save it by
 * hand, find the path, and type it. The clipboard is where it already is.
 *
 * Every platform needs a different incantation and none of them are pretty.
 * They share one shape, though, and it is worth stating because it is what
 * makes the caller simple: **either an image file lands on disk and its path
 * comes back, or the answer is null.** Nothing here throws for the ordinary
 * case of "there is no image on the clipboard", because that is not an error —
 * it is the answer most of the time.
 *
 * Two kinds of clipboard content count as an image, and both are handled:
 * a raw bitmap (what a screenshot tool puts there) and a file reference (what
 * copying a PNG in a file manager puts there).
 */

import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Put UTF-8 text in the system clipboard without shell interpolation. */
export async function writeClipboardText(text: string): Promise<void> {
  const command = process.platform === 'win32'
    ? 'powershell.exe'
    : process.platform === 'darwin'
      ? 'pbcopy'
      : 'wl-copy';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', '$input | Set-Clipboard']
    : [];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(error.trim() || `clipboard command exited with ${code ?? 'unknown status'}`));
    });
    child.stdin.end(text, 'utf8');
  }).catch(async (error) => {
    if (process.platform !== 'linux') throw error;
    await new Promise<void>((resolve, reject) => {
      const child = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'pipe'] });
      let detail = '';
      child.stderr.on('data', (chunk: Buffer) => { detail += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(detail.trim() || 'xclip failed')));
      child.stdin.end(text, 'utf8');
    });
  });
}

export interface ClipboardImage {
  /** Where it was written. Inside the OS temp directory, never the project. */
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: number;
}

/** Read ordinary clipboard text without treating an empty clipboard as an error. */
export async function readClipboardText(): Promise<string | null> {
  if (process.platform === 'win32') {
    const script = `
$ErrorActionPreference = 'Stop'
$text = Get-Clipboard -Raw
if ($null -eq $text) { exit 0 }
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$text)))
`;
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    ).catch(() => ({ stdout: '' }));
    const encoded = stdout.trim();
    return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : null;
  }

  if (process.platform === 'darwin') {
    const { stdout } = await run('pbpaste', [], { maxBuffer: 16 * 1024 * 1024 }).catch(() => ({ stdout: '' }));
    return stdout || null;
  }

  for (const [command, args] of [
    ['wl-paste', ['--no-newline']] as const,
    ['xclip', ['-selection', 'clipboard', '-o']] as const,
  ]) {
    try {
      const { stdout } = await run(command, [...args], { maxBuffer: 16 * 1024 * 1024 });
      if (stdout) return stdout;
    } catch {
      // Try the next clipboard implementation.
    }
  }
  return null;
}

/**
 * Ceiling on what will be attached.
 *
 * A base64 image goes into the request body and therefore into the context
 * window. Ten megabytes of PNG is roughly thirteen of base64, which several
 * endpoints reject outright and the rest bill for. A screenshot is well under
 * this; a photograph pasted by accident is not, and being told so beats a
 * request that fails a minute later.
 */
const MAX_BYTES = 8 * 1024 * 1024;

export const MAX_ATTACHMENT_BYTES = MAX_BYTES;

/** Where pasted images go. Per-user temp, as the developer asked. */
export function pasteDirectory(): string {
  return path.join(os.tmpdir(), 'plif-pasted');
}

export async function readClipboardImage(): Promise<ClipboardImage | null> {
  const target = path.join(pasteDirectory(), `paste-${Date.now()}-${randomUUID().slice(0, 8)}.png`);
  await fs.mkdir(path.dirname(target), { recursive: true });

  const written =
    process.platform === 'win32'
      ? await fromWindows(target)
      : process.platform === 'darwin'
        ? await fromMac(target)
        : await fromLinux(target);

  if (!written) return null;

  const stat = await fs.stat(written).catch(() => null);
  if (!stat || stat.size === 0) {
    await fs.rm(written, { force: true }).catch(() => undefined);
    return null;
  }
  if (stat.size > MAX_BYTES) {
    await fs.rm(written, { force: true }).catch(() => undefined);
    throw new Error(
      `that image is ${(stat.size / 1024 / 1024).toFixed(1)}MB, over the ${
        MAX_BYTES / 1024 / 1024
      }MB limit for an attachment`,
    );
  }

  return { path: written, mediaType: mediaTypeOf(written), bytes: stat.size };
}

/**
 * Windows, through PowerShell and WinForms.
 *
 * `-STA` is load-bearing rather than defensive: the clipboard is an OLE
 * single-threaded-apartment API, and `Clipboard::GetImage` on the default MTA
 * thread returns null for a clipboard that plainly has an image on it. That
 * failure is silent and looks exactly like an empty clipboard, which is the
 * worst way for it to be wrong.
 */
async function fromWindows(target: string): Promise<string | null> {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# A copied file wins over a rendered bitmap: it is the original bytes, at the
# original quality, in whatever format it already was.
$files = [System.Windows.Forms.Clipboard]::GetFileDropList()
foreach ($file in $files) {
  if ($file -match '\\.(png|jpe?g|gif|bmp|webp)$') {
    [Console]::Out.Write('FILE:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$file)))
    exit 0
  }
}

$image = [System.Windows.Forms.Clipboard]::GetImage()
if ($image -ne $null) {
  $image.Save(${JSON.stringify(target)}, [System.Drawing.Imaging.ImageFormat]::Png)
  $image.Dispose()
  Write-Output "SAVED"
  exit 0
}
Write-Output "NONE"
`;

  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  ).catch(() => ({ stdout: 'NONE' }));

  const answer = stdout.trim();
  if (answer.startsWith('FILE:')) {
    const encoded = answer.slice(5).replace(/\s+/g, '');
    const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim();
    return decoded || null;
  }
  return answer.includes('SAVED') ? target : null;
}

async function fromMac(target: string): Promise<string | null> {
  // osascript is always present; `pngpaste` is not, so it is not relied on.
  const script = `
    set outFile to POSIX file ${JSON.stringify(target)}
    try
      set imageData to the clipboard as «class PNGf»
    on error
      return "NONE"
    end try
    set fileRef to open for access outFile with write permission
    set eof fileRef to 0
    write imageData to fileRef
    close access fileRef
    return "SAVED"
  `;
  const { stdout } = await run('osascript', ['-e', script]).catch(() => ({ stdout: 'NONE' }));
  return stdout.includes('SAVED') ? target : null;
}

/**
 * Linux, trying Wayland before X11.
 *
 * Neither tool is guaranteed to exist, and a missing one is not an error worth
 * surfacing — it is the same "no image available" the caller already handles.
 */
async function fromLinux(target: string): Promise<string | null> {
  const attempts: [string, string[]][] = [
    ['wl-paste', ['--type', 'image/png']],
    ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
  ];

  for (const [command, args] of attempts) {
    try {
      const { stdout } = await run(command, args, {
        encoding: 'buffer',
        maxBuffer: MAX_BYTES + 1024,
      });
      const data = stdout as unknown as Buffer;
      if (data.length === 0) continue;
      await fs.writeFile(target, data);
      return target;
    } catch {
      continue;
    }
  }
  return null;
}

export function mediaTypeOf(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'image/png';
  }
}
