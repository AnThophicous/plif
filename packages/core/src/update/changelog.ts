import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

export interface ChangelogSection {
  readonly version: string;
  readonly text: string;
}

function normalizedVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

export function changelogSection(text: string, version: string): ChangelogSection | null {
  const target = normalizedVersion(version);
  if (!target) return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => new RegExp(`^##\\s+\\[?v?${escapeRegExp(target)}(?:\\]|\\s|$)`, 'i').test(line.trim()));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index]?.trim() ?? '')) {
      end = index;
      break;
    }
  }
  const section = lines.slice(start, end).join('\n').trim();
  return section ? { version: target, text: section } : null;
}

export async function readChangelog(file: string, version: string): Promise<ChangelogSection | null> {
  try {
    return changelogSection(await fs.readFile(file, 'utf8'), version);
  } catch {
    return null;
  }
}

export function changelogFromNpmTarball(payload: Uint8Array, version: string): ChangelogSection | null {
  let tar: Buffer;
  try {
    tar = gunzipSync(payload);
  } catch {
    return null;
  }
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText || '0', 8);
    if (!Number.isFinite(size) || size < 0) return null;
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) return null;
    if (name === 'package/CHANGELOG.md' || name === 'CHANGELOG.md') {
      return changelogSection(tar.subarray(bodyStart, bodyEnd).toString('utf8'), version);
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

export function assertChangelogSection(text: string, version: string): ChangelogSection {
  const section = changelogSection(text, version);
  if (!section) throw new Error(`CHANGELOG.md does not contain a section for ${normalizedVersion(version)}`);
  return section;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

