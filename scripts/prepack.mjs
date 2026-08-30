import { chmodSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
const cli = manifest.name === '@plif/cli';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

function changelogSection(text, version) {
  const normalized = String(version).trim().replace(/^v/i, '');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const heading = new RegExp(`^##\\s+\\[?v?${escapeRegExp(normalized)}(?:\\]|\\s|$)`, 'i');
  const start = lines.findIndex((line) => heading.test(line.trim()));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^##\\s+/.test(line.trim()));
  const section = lines.slice(start, end < 0 ? lines.length : end).join('\n').trim();
  return section || null;
}

function copyRequired(name) {
  const source = path.join(root, name);
  if (!existsSync(source)) throw new Error(`prepack: ${name} is missing from the repository root`);
  copyFileSync(source, path.join(target, name));
}

copyRequired('LICENSE');
copyRequired('NOTICE');

if (cli) {
  copyRequired('README.md');
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  if (!changelogSection(changelog, manifest.version)) {
    throw new Error(`prepack: CHANGELOG.md does not contain a section for ${manifest.version}`);
  }
  copyRequired('CHANGELOG.md');

  const updaterRoot = path.join(target, 'assets', 'updater');
  const assets = [
    ['windows-x64', 'plif-updater.exe'],
    ['windows-arm64', 'plif-updater.exe'],
    ['linux-x64', 'plif-updater'],
    ['linux-arm64', 'plif-updater'],
  ];
  const missing = assets.filter(([directory, binary]) => !existsSync(path.join(updaterRoot, directory, binary)));
  if (process.env['PLIF_RELEASE'] === '1' && missing.length > 0) {
    throw new Error(`prepack: missing updater assets: ${missing.map(([directory, binary]) => `${directory}/${binary}`).join(', ')}`);
  }
  for (const [directory, binary] of assets) {
    const file = path.join(updaterRoot, directory, binary);
    if (existsSync(file) && !file.endsWith('.exe')) chmodSync(file, 0o755);
  }
}
