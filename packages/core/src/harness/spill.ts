/**
 * Large tool output goes to a file, not into the context window.
 *
 * Until now a tool that produced more than 24,000 characters had its middle
 * deleted — head and tail kept, everything between replaced by a note saying
 * how much was dropped. That is two losses at once. The obvious one is that
 * the content is *gone*: a 200,000-line log, a big file, a wide grep, and the
 * part the model needed was almost certainly in the middle. The less obvious
 * one is that the 24,000 characters that survive still cost roughly six
 * thousand tokens of context, every turn, forever — the model paid for the
 * output and did not get it.
 *
 * Spilling inverts both. The whole output is written to a file inside the
 * container's temp mount, and what enters the context is a short preview plus
 * the path. Nothing is lost, because the file is complete. The context cost
 * drops to the preview, because the rest is on disk. And when the model wants
 * a specific part it uses `grep` or `read_file` on the path — which is a
 * targeted read of the lines it actually needs instead of a bulk transfer of
 * everything it might need.
 *
 * That last point is the reason this needs no new tool. plif already has
 * `read_file` and `grep`, they already work on container-absolute paths, and
 * `/temp` is already mounted. A spill handle is just a path those tools can
 * take, so the model needs no new instruction to use it beyond "here is where
 * it went".
 */

import type { Container } from '../container/container.js';

/** Where spill files live inside the container. Under the temp mount, so they are disposable. */
export const SPILL_DIRECTORY = '/temp/spill';

/**
 * Output at or above this many characters is spilled.
 *
 * Well below the old 24,000-character clip: the point is not to rescue only
 * the pathological cases but to stop paying for bulk output at all. Below it,
 * inlining is cheaper than the round trip of a spill plus a read.
 */
export const SPILL_THRESHOLD = 6_000;

/** How much of the head and tail stay inline as a preview. */
const PREVIEW_HEAD = 1_200;
const PREVIEW_TAIL = 800;

export interface SpillRecord {
  /** Container-absolute path of the complete output. */
  readonly path: string;
  readonly bytes: number;
  readonly lines: number;
}

/**
 * Writes spilled output for one session.
 *
 * Numbered per store rather than per tool so two calls to the same tool never
 * collide, and so the ordering in the directory matches the ordering of the
 * run — which is what makes the files useful to a human reading them after the
 * fact.
 */
export class SpillStore {
  #container: Container;
  #sequence = 0;
  #ensured = false;

  constructor(container: Container) {
    this.#container = container;
  }

  async write(label: string, text: string): Promise<SpillRecord | null> {
    if (!this.#ensured) {
      // A container whose temp mount is missing or read-only must not turn
      // every large tool result into a failure: spilling is an optimisation,
      // and the caller falls back to inline truncation when it returns null.
      try {
        await this.#container.writeFile(`${SPILL_DIRECTORY}/.keep`, '');
        this.#ensured = true;
      } catch {
        return null;
      }
    }
    const safe = label.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'output';
    const name = `${String(++this.#sequence).padStart(4, '0')}-${safe}.txt`;
    const path = `${SPILL_DIRECTORY}/${name}`;
    try {
      await this.#container.writeFile(path, text);
    } catch {
      return null;
    }
    return { path, bytes: text.length, lines: text.split('\n').length };
  }
}

/** The sink a tool sees. Kept minimal so a caller can substitute one in a test. */
export interface SpillSink {
  write(label: string, text: string): Promise<SpillRecord | null>;
}

function preview(text: string): string {
  const head = text.slice(0, PREVIEW_HEAD);
  const tail = text.slice(-PREVIEW_TAIL);
  return `${head}\n…\n${tail}`;
}

/**
 * Format spilled output for the model.
 *
 * The wording matters more than it looks. A model that reads "truncated" stops
 * — there is nothing it can do about truncation. A model that reads the path
 * and the two tools that open it will go and get the rest when it needs it,
 * which is the whole behaviour this feature exists to produce.
 */
export function describeSpill(record: SpillRecord, text: string): string {
  return [
    preview(text),
    '',
    `[Full output: ${record.lines.toLocaleString('en-US')} lines, ` +
      `${record.bytes.toLocaleString('en-US')} characters, saved to ${record.path}]`,
    `Nothing was lost. Use grep with a pattern on ${record.path} to find a specific part, ` +
      `or read_file to read it. Do not read the whole file unless you need all of it.`,
  ].join('\n');
}

/**
 * Spill when it is worth it, otherwise hand the text back unchanged.
 *
 * The caller is expected to apply its own inline cap to whatever comes back,
 * so a container that cannot spill still cannot blow the context window.
 */
export async function spillLargeOutput(
  text: string,
  label: string,
  sink: SpillSink | undefined,
): Promise<string> {
  if (!sink || text.length < SPILL_THRESHOLD) return text;
  const record = await sink.write(label, text);
  if (!record) return text;
  return describeSpill(record, text);
}
