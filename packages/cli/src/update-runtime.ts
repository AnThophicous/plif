import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { moduleDirectory, resolveAsset } from '@plif/core';
import type { UpdateStatus } from '@plif/core';

function updaterFile(): string | null {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : null;
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : null;
  if (!platform || !arch) return null;
  const binary = platform === 'windows' ? 'plif-updater.exe' : 'plif-updater';
  const override = process.env['PLIF_UPDATER_PATH']?.trim();
  if (override) return path.resolve(override);
  const relative = path.join('updater', `${platform}-${arch}`, binary);
  return resolveAsset(import.meta.url, relative, [
    path.resolve(moduleDirectory(import.meta.url), '..', 'assets', relative),
  ]);
}

export function launchUpdater(update: UpdateStatus): boolean {
  const updater = updaterFile();
  if (!updater || !update.packageName || !update.integrity || !existsSync(updater)) return false;
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;
  const args = [
    '--package', update.packageName,
    '--version', update.latest,
    '--registry', 'https://registry.npmjs.org',
    '--parent-pid', String(process.pid),
    '--relaunch', process.execPath,
    '--relaunch-arg', entrypoint,
    ...process.argv.slice(2).flatMap((argument) => ['--relaunch-arg', argument]),
    ...(update.integrity ? ['--integrity', update.integrity] : []),
  ];
  try {
    const child = spawn(updater, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function updaterPath(): string | null {
  return updaterFile();
}
