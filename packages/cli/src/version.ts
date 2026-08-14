import { readFileSync } from 'node:fs';

interface PackageMetadata {
  readonly version?: unknown;
}

const metadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageMetadata;

if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
  throw new Error('CLI package metadata does not contain a version');
}

/** The published CLI version, sourced from the package that owns this entrypoint. */
export const VERSION = metadata.version;

/** Human-facing release wording used by the interactive terminal identity. */
export const VERSION_LABEL = /^(\d+\.\d+\.\d+)-(?:pre|preview)(?:\.\d+)?$/i.test(VERSION)
  ? `${VERSION.slice(0, VERSION.indexOf('-'))} Pre-Release`
  : VERSION;
