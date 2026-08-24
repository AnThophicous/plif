import fs from 'node:fs/promises';
import path from 'node:path';

import { globalConfigPath } from '../../config/global.js';
import { normalizeTokenSplitConfig, defaultTokenSplitConfig } from './registry.js';
import type { TokenSplitConfig } from './types.js';

const writes = new Map<string, Promise<void>>();

export function tokenSplitConfigPath(configFile = globalConfigPath()): string {
  return path.join(path.dirname(configFile), 'token-split.json');
}
export async function loadTokenSplitConfig(file = tokenSplitConfigPath()): Promise<TokenSplitConfig> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return normalizeTokenSplitConfig(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultTokenSplitConfig();
    return defaultTokenSplitConfig();
  }
}

export async function saveTokenSplitConfig(config: TokenSplitConfig, file = tokenSplitConfigPath()): Promise<void> {
  const previous = writes.get(file) ?? Promise.resolve();
  const next = previous.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(config, null, 2) + '\n', 'utf8');
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600).catch(() => undefined);
  });
  writes.set(file, next);
  try {
    await next;
  } finally {
    if (writes.get(file) === next) writes.delete(file);
  }
}
