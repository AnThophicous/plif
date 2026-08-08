import path from 'node:path';

export function containerWorkdir(hostCwd: string): string {
  const name = path.basename(path.resolve(hostCwd));
  return name ? `/${name}` : '/';
}

export function containerMount(hostCwd: string): {
  source: string;
  target: '/';
  mode: 'rw';
  mask: readonly string[];
} {
  const source = path.dirname(path.resolve(hostCwd));
  const workdir = containerWorkdir(hostCwd);
  const prefix = workdir === '/' ? '' : workdir;
  return {
    source,
    target: '/',
    mode: 'rw',
    mask: [`${prefix}/.git/config`, `${prefix}/.env`, `${prefix}/.env.local`],
  };
}
