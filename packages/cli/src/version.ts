import { readFileSync } from 'node:fs';
import path from 'node:path';

import { moduleDirectory, resolveAsset } from '@plif/core';

interface PackageMetadata {
  readonly version?: unknown;
}

const metadataFile = resolveAsset(import.meta.url, 'cli/package.json', [
  path.resolve(moduleDirectory(import.meta.url), '../package.json'),
]);

if (metadataFile === null) {
  throw new Error('CLI package metadata is missing from this install');
}

const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as PackageMetadata;

if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
  throw new Error('CLI package metadata does not contain a version');
}

/** The published CLI version, sourced from the package that owns this entrypoint. */
export const VERSION = metadata.version;

/** Human-facing release wording used by the interactive terminal identity. */
export const VERSION_LABEL = /^(\d+\.\d+\.\d+)-(?:pre|preview)(?:\.\d+)?$/i.test(VERSION)
  ? `${VERSION.slice(0, VERSION.indexOf('-'))} Pre-Release`
  : VERSION;
