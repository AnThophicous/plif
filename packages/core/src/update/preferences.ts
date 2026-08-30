import fs from 'node:fs/promises';
import path from 'node:path';

export interface UpdatePreferences {
  readonly disabledVersions: readonly string[];
  readonly enabled: boolean;
}

const DEFAULT_PREFERENCES: UpdatePreferences = { disabledVersions: [], enabled: true };

export async function readUpdatePreferences(file: string): Promise<UpdatePreferences> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<UpdatePreferences>;
    return {
      enabled: raw.enabled !== false,
      disabledVersions: Array.isArray(raw.disabledVersions)
        ? raw.disabledVersions.filter((version): version is string => typeof version === 'string')
        : [],
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function writeUpdatePreferences(file: string, preferences: UpdatePreferences): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({
    enabled: preferences.enabled,
    disabledVersions: [...new Set(preferences.disabledVersions)],
  }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, file);
}

export async function disableVersion(file: string, version: string): Promise<void> {
  const current = await readUpdatePreferences(file);
  if (current.disabledVersions.includes(version)) return;
  await writeUpdatePreferences(file, {
    ...current,
    disabledVersions: [...current.disabledVersions, version],
  });
}

