import path from 'node:path';

import { TEMP_WORKDIR } from './temp-workspace.js';

export const WORKSPACE_SECRET_MASKS: readonly string[] = [
  '/.git',
  '/.env',
  '/.env.*',
  '/.npmrc',
  '/.pypirc',
  '/.netrc',
  '/.plif',
  '/*.pem',
  '/*.key',
  '/**/*.pem',
  '/**/*.key',
  '/secrets*',
  '/credentials*',
  '/**/secrets*',
  '/**/credentials*',
];

export function containerWorkdir(_hostCwd: string): string {
  return '/project';
}

export function containerMount(hostCwd: string): {
  source: string;
  target: '/project';
  mode: 'rw';
  mask: readonly string[];
} {
  const source = path.resolve(hostCwd);
  return {
    source,
    target: '/project',
    mode: 'rw',
    mask: WORKSPACE_SECRET_MASKS,
  };
}

/** Mount the disposable per-session scratch directory separately from /project. */
export function containerTempMount(tempDir: string): {
  source: string;
  target: typeof TEMP_WORKDIR;
  mode: 'rw';
  mask: readonly string[];
} {
  return {
    source: path.resolve(tempDir),
    target: TEMP_WORKDIR,
    mode: 'rw',
    mask: [],
  };
}
