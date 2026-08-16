import path from 'node:path';

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
    mask: ['/.git/config', '/.env', '/.env.local'],
  };
}
