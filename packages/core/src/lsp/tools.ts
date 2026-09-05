import path from 'node:path';

import type { Tool, ToolContext, ToolResult } from '../harness/tools.js';
import { countBySeverity, formatDiagnostics } from './manager.js';
import type { LspManager } from './manager.js';
import type { DocumentEdit, LspClient, Location, TextEdit } from './client.js';

async function hostPath(context: ToolContext, virtualPath: string): Promise<string> {
  return await context.container.hostPathFor(virtualPath);
}

function requirePath(input: Record<string, unknown>): string {
  const value = input['path'];
  if (typeof value !== 'string' || !value) {
    throw new Error('path must be a container-absolute path like /project/src/index.ts');
  }
  return value;
}

function position(input: Record<string, unknown>): { line: number; column: number } {
  const line = Number(input['line']);
  const column = Number(input['column'] ?? 1);
  if (!Number.isFinite(line) || line < 1) {
    throw new Error('line must be a 1-based number');
  }
  return { line, column: Number.isFinite(column) && column >= 1 ? column : 1 };
}

const REFERENCE_SETTLE_MS = 250;
const REFERENCE_SETTLE_ATTEMPTS = 40;

function pathKey(file: string): string {
  const absolute = path.resolve(file);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/**
 * Wait until the server can name the places that use this position.
 *
 * The call sites are the readiness signal for a rename, because they are the
 * thing a rename is made of. Nothing cheaper stands in for them: measured on
 * this repository, the server published diagnostics for the file — its own
 * program built — while still answering "no references", and only four seconds
 * later reported the twenty real ones. A rename issued in that gap rewrites the
 * declaration alone and says it succeeded.
 *
 * An empty result after the ceiling is taken at face value: plenty of symbols
 * genuinely have no other use, and refusing those would make the tool useless
 * for exactly the renames that are safest.
 */
async function settledReferences(
  client: LspClient,
  file: string,
  line: number,
  column: number,
): Promise<Location[]> {
  let found = await client.references(file, line, column);
  for (
    let attempt = 0;
    found.length === 0 && attempt < REFERENCE_SETTLE_ATTEMPTS;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, REFERENCE_SETTLE_MS));
    found = await client.references(file, line, column);
  }
  return found;
}

function sameSegment(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * Map the host paths a language server reports back into container paths.
 *
 * The jail translates one way only, and deliberately: it resolves intent, not
 * strings. But a rename touches files the caller never named, and writing them
 * has to go through the container like every other write. The pair the caller
 * already holds — the container path it asked about and the host path the jail
 * returned for it — pins the two roots against each other, and every other file
 * is mapped by that pairing. Anything outside the shared root has no container
 * path at all, so it is refused rather than guessed.
 */
function hostToVirtual(
  virtualPath: string,
  hostPath: string,
): ((host: string) => string | null) | null {
  const virtualParts = virtualPath.split('/').filter(Boolean);
  const absolute = path.resolve(hostPath);
  const hostParts = absolute.split(path.sep).filter(Boolean);

  let shared = 0;
  while (
    shared < virtualParts.length &&
    shared < hostParts.length &&
    sameSegment(
      virtualParts[virtualParts.length - 1 - shared]!,
      hostParts[hostParts.length - 1 - shared]!,
    )
  ) {
    shared += 1;
  }
  if (shared === 0) return null;

  let hostRoot = absolute;
  for (let step = 0; step < shared; step += 1) hostRoot = path.dirname(hostRoot);
  const virtualRoot = '/' + virtualParts.slice(0, virtualParts.length - shared).join('/');

  return (host: string): string | null => {
    const relative = path.relative(hostRoot, path.resolve(host));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const suffix = relative.split(path.sep).join('/');
    return virtualRoot === '/' ? `/${suffix}` : `${virtualRoot}/${suffix}`;
  };
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

/**
 * Apply a server edit list to one file, or refuse the file entirely.
 *
 * Returns null instead of a partial result whenever the edits do not fit: a
 * position past the end of the file, a reversed range, or a pair that overlaps.
 * The protocol forbids overlap, and a server that sends it anyway would corrupt
 * the file silently — which is worse than the rename not happening.
 */
function applyTextEdits(text: string, edits: readonly TextEdit[]): string | null {
  const starts = lineStarts(text);
  const offsetOf = (line: number, column: number): number | null => {
    const base = starts[line - 1];
    if (base === undefined) return null;
    const offset = base + (column - 1);
    return offset >= 0 && offset <= text.length ? offset : null;
  };

  const placed: { start: number; end: number; newText: string }[] = [];
  for (const edit of edits) {
    const start = offsetOf(edit.startLine, edit.startColumn);
    const end = offsetOf(edit.endLine, edit.endColumn);
    if (start === null || end === null || end < start) return null;
    placed.push({ start, end, newText: edit.newText });
  }

  placed.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < placed.length; index += 1) {
    if (placed[index]!.start < placed[index - 1]!.end) return null;
  }

  let out = '';
  let cursor = 0;
  for (const edit of placed) {
    out += text.slice(cursor, edit.start) + edit.newText;
    cursor = edit.end;
  }
  return out + text.slice(cursor);
}

interface PlannedWrite {
  readonly target: string;
  readonly content: string;
  readonly occurrences: number;
}

/**
 * Turn server edits into writes, or into the reason there will be none.
 *
 * Every document is resolved and applied in memory before anything is written,
 * because half of a multi-file edit is worse than none of it: the caller would
 * be told it succeeded and find out from a later build.
 */
async function planWrites(
  context: ToolContext,
  toVirtual: (host: string) => string | null,
  documents: readonly DocumentEdit[],
): Promise<{ writes: PlannedWrite[] } | { error: string }> {
  const writes: PlannedWrite[] = [];
  for (const document of documents) {
    const target = toVirtual(document.file);
    if (!target) {
      return {
        error:
          `The change reaches ${document.file}, which is outside this workspace. ` +
          'Nothing was changed.',
      };
    }

    const before = await context.container.readFile(target).catch(() => null);
    if (before === null) {
      return { error: `Could not read ${target} to apply the change. Nothing was changed.` };
    }
    const after = applyTextEdits(before, document.edits);
    if (after === null) {
      return {
        error: `The edits for ${target} do not fit its current contents. Nothing was changed.`,
      };
    }
    if (after !== before) {
      writes.push({ target, content: after, occurrences: document.edits.length });
    }
  }
  return { writes };
}

async function commitWrites(context: ToolContext, writes: readonly PlannedWrite[]): Promise<void> {
  for (const write of writes) {
    if (context.edits && context.agentId) {
      await context.edits.commit(context.agentId, write.target, write.content, context.container);
    } else {
      await context.container.writeFile(write.target, write.content);
    }
  }
}

export function diagnosticsTool(lsp: LspManager): Tool {
  return {
    spec: {
      name: 'diagnostics',
      description:
        'Ask the language server what is wrong with a file — type errors, unresolved ' +
        'imports, unused symbols. Faster and more precise than running the compiler, ' +
        'and it works on a file you just wrote. Use it after editing before you run tests.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Container-absolute path to the file' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const virtualPath = requirePath(input);
      const file = await hostPath(context, virtualPath);
      const found = await lsp.diagnose(file);

      if (found === null) {
        return {
          output:
            `No language server is running for ${path.extname(virtualPath) || 'this file type'}. ` +
            'This is not the same as "no problems" — nothing analysed it. Run the ' +
            'compiler or the tests instead.',
          ok: false,
        };
      }
      if (found.length === 0) {
        return { output: `${virtualPath}: no problems reported.`, ok: true };
      }

      const { errors, warnings } = countBySeverity(found);
      return {
        output:
          `${errors} error(s), ${warnings} warning(s) in ${virtualPath}\n\n` +
          formatDiagnostics(found, lsp.root),
        ok: errors === 0,
      };
    },
  };
}

export function definitionTool(lsp: LspManager): Tool {
  return {
    spec: {
      name: 'find_definition',
      description:
        'Jump to where a symbol is defined. Give the file and the 1-based line and ' +
        'column where the symbol appears. Use this instead of grepping for a name — ' +
        'it follows imports and re-exports, and it does not match comments. Set kind ' +
        'to reach an interface implementation or the declaration of an expression type.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Container-absolute path' },
          line: { type: 'number', description: '1-based line of the symbol' },
          column: { type: 'number', description: '1-based column of the symbol' },
          kind: {
            type: 'string',
            enum: ['definition', 'implementation', 'type'],
            description:
              'definition (default) is where it is declared; implementation is which ' +
              'classes implement this interface or abstract member; type is where the ' +
              'type of this expression is declared',
          },
        },
        required: ['path', 'line'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const virtualPath = requirePath(input);
      const { line, column } = position(input);
      const kind = input['kind'];
      const file = await hostPath(context, virtualPath);

      const client = await lsp.clientFor(file);
      if (!client) return { output: 'No language server for this file type.', ok: false };

      const locations =
        kind === 'implementation'
          ? await client.implementation(file, line, column)
          : kind === 'type'
            ? await client.typeDefinition(file, line, column)
            : await client.definition(file, line, column);
      if (locations.length === 0) {
        const asked =
          kind === 'implementation'
            ? 'implementation'
            : kind === 'type'
              ? 'type declaration'
              : 'definition';
        return { output: `No ${asked} found at that position.`, ok: false };
      }
      return {
        output: locations
          .map(
            (location) =>
              `${path.relative(lsp.root, location.file).replace(/\\/g, '/')}:${location.line}:${location.column}`,
          )
          .join('\n'),
        ok: true,
      };
    },
  };
}

export function referencesTool(lsp: LspManager): Tool {
  return {
    spec: {
      name: 'find_references',
      description:
        'List every place a symbol is used. Give the file and the 1-based line and ' +
        'column where it appears. Use this before renaming or deleting anything — it ' +
        'finds callers a grep for the name would miss or over-report. Set kind to ' +
        'walk the call graph instead of listing uses.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Container-absolute path' },
          line: { type: 'number', description: '1-based line of the symbol' },
          column: { type: 'number', description: '1-based column of the symbol' },
          kind: {
            type: 'string',
            enum: ['references', 'callers', 'callees'],
            description:
              'references (default) every use; callers the functions that call this ' +
              'one; callees the functions this one calls',
          },
        },
        required: ['path', 'line'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const virtualPath = requirePath(input);
      const { line, column } = position(input);
      const kind = input['kind'];
      const file = await hostPath(context, virtualPath);

      const client = await lsp.clientFor(file);
      if (!client) return { output: 'No language server for this file type.', ok: false };

      if (kind === 'callers' || kind === 'callees') {
        const edges = await client.calls(file, line, column, kind === 'callers' ? 'incoming' : 'outgoing');
        if (edges.length === 0) {
          return {
            output: kind === 'callers'
              ? 'Nothing calls this. It may be an entry point, or dead.'
              : 'This calls nothing the server can resolve.',
            ok: true,
          };
        }
        return {
          output: edges
            .map(
              (edge) =>
                `${path.relative(lsp.root, edge.file).replace(/\\/g, '/')}:${edge.line}  ${edge.name}`,
            )
            .join('\n'),
          ok: true,
        };
      }

      const locations = await client.references(file, line, column);
      if (locations.length === 0) {
        return { output: 'No references found. Nothing else uses this symbol.', ok: true };
      }

      const shown = locations.slice(0, 60);
      const lines = shown.map(
        (location) =>
          `${path.relative(lsp.root, location.file).replace(/\\/g, '/')}:${location.line}:${location.column}`,
      );
      if (locations.length > shown.length) {
        lines.push(`… and ${locations.length - shown.length} more`);
      }
      return { output: `${locations.length} reference(s)\n${lines.join('\n')}`, ok: true };
    },
  };
}

export function outlineTool(lsp: LspManager): Tool {
  return {
    spec: {
      name: 'outline',
      description:
        'List the symbols a file declares — classes, functions, types — with their ' +
        'line numbers. Cheaper than reading a large file when you only need to know ' +
        'what is in it and where.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Container-absolute path' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const virtualPath = requirePath(input);
      const file = await hostPath(context, virtualPath);

      const client = await lsp.clientFor(file);
      if (!client) return { output: 'No language server for this file type.', ok: false };

      const symbols = await client.symbols(file);
      if (symbols.length === 0) {
        return { output: 'No symbols reported for this file.', ok: true };
      }
      return {
        output: symbols
          .map((symbol) => `${String(symbol.line).padStart(5)}  ${symbol.kind.padEnd(12)} ${symbol.name}`)
          .join('\n'),
        ok: true,
      };
    },
  };
}

export function workspaceSymbolTool(lsp: LspManager): Tool {
  return {
    spec: {
      name: 'find_symbol',
      description:
        'Find where something is declared anywhere in the project, by name — a class, ' +
        'function, type, constant or method — without knowing which file holds it. Use ' +
        'this instead of grepping a name across the tree: it returns declarations only, ' +
        'so it never matches a comment, a string or a call site. A partial name works.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Symbol name or a prefix of it, for example "LspManager"',
          },
          limit: {
            type: 'number',
            description: 'Most hits to return; defaults to 40',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const query = typeof input['query'] === 'string' ? input['query'].trim() : '';
      if (!query) {
        return { output: 'query must be a symbol name or a prefix of one.', ok: false };
      }
      const requested = Number(input['limit']);
      const limit = Number.isFinite(requested) && requested >= 1 ? Math.min(requested, 200) : 40;

      const hits = await lsp.searchSymbols(query, limit);
      if (hits === null) {
        return {
          output:
            'No language server is running for this workspace, so nothing indexes its ' +
            'symbols. This is not the same as "no such symbol" — search the files instead.',
          ok: false,
        };
      }
      if (hits.length === 0) {
        return { output: `No declaration matching "${query}".`, ok: true };
      }

      const lines = hits.map((hit) => {
        const where = `${path.relative(lsp.root, hit.file).replace(/\\/g, '/')}:${hit.line}`;
        const owner = hit.container ? ` (in ${hit.container})` : '';
        return `${where}  ${hit.kind.padEnd(12)} ${hit.name}${owner}`;
      });
      const capped =
        hits.length >= limit ? `\n… stopped at ${limit}; narrow the query for the rest.` : '';
      return { output: `${hits.length} declaration(s)\n${lines.join('\n')}${capped}`, ok: true };
    },
  };
}

export function describeSymbolTool(lsp: LspManager): Tool {
  return {
    spec: {
      name: 'describe_symbol',
      description:
        'Show the type and documentation of the symbol at a position — the signature, ' +
        'the resolved generics, the doc comment. Use it instead of opening the file a ' +
        'symbol is defined in when all you need is how to call it. Set kind to ' +
        'signature inside a call to see the parameters being filled in.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Container-absolute path' },
          line: { type: 'number', description: '1-based line of the symbol' },
          column: { type: 'number', description: '1-based column of the symbol' },
          kind: {
            type: 'string',
            enum: ['type', 'signature'],
            description: 'type (default) what this symbol is; signature the call being written here',
          },
        },
        required: ['path', 'line'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const virtualPath = requirePath(input);
      const { line, column } = position(input);
      const file = await hostPath(context, virtualPath);

      const client = await lsp.clientFor(file);
      if (!client) return { output: 'No language server for this file type.', ok: false };

      const described = input['kind'] === 'signature'
        ? await client.signatureHelp(file, line, column)
        : await client.hover(file, line, column);
      if (!described) {
        return { output: 'The language server knows nothing about that position.', ok: false };
      }
      return { output: described, ok: true };
    },
  };
}

export function renameTool(lsp: LspManager): Tool {
  return {
    spec: {
      name: 'rename_symbol',
      description:
        'Rename a symbol everywhere it is used, in one step. Give the file and the ' +
        '1-based line and column where the symbol appears, plus the new name. The ' +
        'language server decides what changes, so imports, re-exports and shadowed ' +
        'names are handled and comments and strings are left alone — which is what a ' +
        'search and replace cannot do. Every file is written, or none is.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Container-absolute path' },
          line: { type: 'number', description: '1-based line of the symbol' },
          column: { type: 'number', description: '1-based column of the symbol' },
          new_name: { type: 'string', description: 'The identifier to rename it to' },
          allow_partial: {
            type: 'boolean',
            description:
              'Apply even when the server will not update every file that uses the ' +
              'symbol, and report the ones left behind. Off by default, because the ' +
              'result does not compile until those are changed too.',
          },
        },
        required: ['path', 'line', 'new_name'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const virtualPath = requirePath(input);
      const { line, column } = position(input);
      const newName = typeof input['new_name'] === 'string' ? input['new_name'].trim() : '';
      if (!newName) {
        return { output: 'new_name must be the identifier to rename to.', ok: false };
      }

      const file = await hostPath(context, virtualPath);
      // Not clientFor: a rename asked of a server that has not finished loading
      // the project comes back missing the call sites in files it has not read.
      const client = await lsp.ensureIndexed(file);
      if (!client) return { output: 'No language server for this file type.', ok: false };
      if (!client.supports('renameProvider')) {
        return {
          output:
            'This language server does not implement renaming. Change the occurrences ' +
            'yourself, using find_references to find them.',
          ok: false,
        };
      }

      const toVirtual = hostToVirtual(virtualPath, file);
      if (!toVirtual) {
        return {
          output:
            'Could not map the language server paths back into the container. Nothing ' +
            'was changed.',
          ok: false,
        };
      }

      const references = await settledReferences(client, file, line, column);
      const change = await client.rename(file, line, column, newName);
      if (!change || change.documents.length === 0) {
        return {
          output:
            'The language server would not rename that position. It may not be a symbol, ' +
            'or it may be declared outside this project.',
          ok: false,
        };
      }
      if (change.fileOperations > 0) {
        return {
          output:
            `This rename also requires ${change.fileOperations} file creation, rename or ` +
            'deletion, which this tool does not perform. Nothing was changed.',
          ok: false,
        };
      }

      const plan = await planWrites(context, toVirtual, change.documents);
      if ('error' in plan) return { output: plan.error, ok: false };
      const planned = plan.writes;
      // The server said where this symbol is used; the plan has to reach all of
      // it. Two different things cause a gap, and they look identical from here:
      // an index still filling in behind the request, and a call site the server
      // will not touch at all. Measured on this repository, the second is real —
      // a package that imports the symbol through built .d.ts files sees a
      // different declaration, so the rename stops at the package boundary and no
      // amount of waiting changes it. Either way, applying what came back would
      // break those files while reporting success.
      const covered = new Set(change.documents.map((document) => pathKey(document.file)));
      const untouched = [
        ...new Map(
          references
            .filter((reference) => !covered.has(pathKey(reference.file)))
            .map((reference) => [pathKey(reference.file), toVirtual(reference.file)] as const)
            .filter((entry): entry is readonly [string, string] => entry[1] !== null),
        ).values(),
      ];

      const allowPartial = input['allow_partial'] === true;
      if (untouched.length > 0 && !allowPartial) {
        const listed = untouched.slice(0, 10).join('\n');
        const rest =
          untouched.length > 10 ? '\n' + `… and ${untouched.length - 10} more` : '';
        return {
          output:
            `The language server will not update ${untouched.length} file(s) that use this ` +
            'symbol, so applying the rename would leave them broken:' +
            '\n' + listed + rest + '\n' +
            'This is usually a package boundary the server does not rename across, in ' +
            'which case retrying will not help. Change those files yourself, or pass ' +
            'allow_partial to apply the rest and be told what was left.',
          ok: false,
        };
      }

      if (planned.length === 0) {
        return { output: 'Nothing to change; that symbol already has this name.', ok: true };
      }

      await commitWrites(context, planned);

      const occurrences = planned.reduce((total, write) => total + write.occurrences, 0);
      const listed = planned.map((write) => `${write.target} (${write.occurrences})`);
      const left =
        untouched.length > 0
          ? '\n' +
            'Still using the old name, and now broken — change these yourself:' +
            '\n' +
            untouched.join('\n')
          : '';
      return {
        output:
          `Renamed to ${newName}: ${occurrences} occurrence(s) across ${planned.length} file(s)` +
          '\n' + listed.join('\n') + left,
        ok: untouched.length === 0,
      };
    },
  };
}

export function formatTool(lsp: LspManager): Tool {
  return {
    spec: {
      name: 'format_file',
      description:
        'Reformat a file the way the project already formats code, using the language ' +
        'server rather than a formatter you would have to find and run. Use it after ' +
        'writing a file rather than hand-aligning it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Container-absolute path' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const virtualPath = requirePath(input);
      const file = await hostPath(context, virtualPath);

      const client = await lsp.clientFor(file);
      if (!client) return { output: 'No language server for this file type.', ok: false };
      if (!client.supports('documentFormattingProvider')) {
        return { output: 'This language server does not format.', ok: false };
      }

      const edits = await client.formatting(file);
      if (edits.length === 0) {
        return { output: `${virtualPath} is already formatted.`, ok: true };
      }

      const toVirtual = hostToVirtual(virtualPath, file);
      if (!toVirtual) {
        return { output: 'Could not map the file back into the container.', ok: false };
      }
      const plan = await planWrites(context, toVirtual, [{ file, edits }]);
      if ('error' in plan) return { output: plan.error, ok: false };
      if (plan.writes.length === 0) {
        return { output: `${virtualPath} is already formatted.`, ok: true };
      }

      await commitWrites(context, plan.writes);
      return { output: `Formatted ${virtualPath} (${edits.length} edit(s)).`, ok: true };
    },
  };
}

export function codeActionTool(lsp: LspManager): Tool {
  return {
    spec: {
      name: 'apply_fix',
      description:
        'List or apply the fixes the language server already computed for a position — ' +
        'the same ones an editor shows on a lightbulb: add the missing import, remove ' +
        'the unused symbol, implement the interface. Call it without a title to see ' +
        'what is on offer, then again with one to apply it. Cheaper and more reliable ' +
        'than writing the fix yourself.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Container-absolute path' },
          line: { type: 'number', description: '1-based line' },
          column: { type: 'number', description: '1-based column' },
          title: {
            type: 'string',
            description: 'Exact title of the action to apply; omit to list what is available',
          },
        },
        required: ['path', 'line'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const virtualPath = requirePath(input);
      const { line, column } = position(input);
      const file = await hostPath(context, virtualPath);

      const client = await lsp.clientFor(file);
      if (!client) return { output: 'No language server for this file type.', ok: false };

      // The offers depend on the diagnostics, so make sure there are some.
      await lsp.diagnose(file).catch(() => null);
      const actions = await client.codeActions(file, line, column);
      if (actions.length === 0) {
        return { output: 'The language server offers nothing at that position.', ok: true };
      }

      const wanted = typeof input['title'] === 'string' ? input['title'].trim() : '';
      if (!wanted) {
        return {
          output:
            'Available fixes, by title:\n' +
            actions
              .map((action) => `- ${action.title}${action.needsCommand ? ' (not applicable here)' : ''}`)
              .join('\n'),
          ok: true,
        };
      }

      const chosen = actions.find((action) => action.title === wanted)
        ?? actions.find((action) => action.title.toLowerCase() === wanted.toLowerCase());
      if (!chosen) {
        return {
          output:
            `No fix titled "${wanted}". Available:\n` +
            actions.map((action) => `- ${action.title}`).join('\n'),
          ok: false,
        };
      }
      if (!chosen.change || chosen.change.documents.length === 0) {
        return {
          output:
            `"${chosen.title}" is run by the language server rather than shipped as an ` +
            'edit, which this tool cannot do. Make the change yourself.',
          ok: false,
        };
      }
      if (chosen.change.fileOperations > 0) {
        return {
          output:
            `"${chosen.title}" also creates, renames or deletes files, which this tool ` +
            'does not do. Nothing was changed.',
          ok: false,
        };
      }

      const toVirtual = hostToVirtual(virtualPath, file);
      if (!toVirtual) {
        return { output: 'Could not map the language server paths back into the container.', ok: false };
      }
      const plan = await planWrites(context, toVirtual, chosen.change.documents);
      if ('error' in plan) return { output: plan.error, ok: false };
      if (plan.writes.length === 0) {
        return { output: `"${chosen.title}" would change nothing.`, ok: true };
      }

      await commitWrites(context, plan.writes);
      return {
        output:
          `Applied "${chosen.title}" to ${plan.writes.length} file(s)\n` +
          plan.writes.map((write) => write.target).join('\n'),
        ok: true,
      };
    },
  };
}

export function lspTools(lsp: LspManager): Tool[] {
  return [
    diagnosticsTool(lsp),
    definitionTool(lsp),
    referencesTool(lsp),
    outlineTool(lsp),
    workspaceSymbolTool(lsp),
    describeSymbolTool(lsp),
    renameTool(lsp),
    formatTool(lsp),
    codeActionTool(lsp),
  ];
}

/**
 * Fold diagnostics into the result of a write.
 *
 * The agent should not have to remember to check its own work: the moment a file
 * is written, the compiler's opinion of it is the single most useful thing that
 * can be said, and attaching it here costs one round trip instead of a whole
 * extra turn. Silence when there is no server, because inventing "looks fine"
 * for an unanalysed file is worse than saying nothing.
 */
export async function diagnosticsAfterWrite(
  lsp: LspManager,
  hostFile: string,
): Promise<string | null> {
  const found = await lsp.diagnose(hostFile).catch(() => null);
  if (found === null || found.length === 0) return null;

  const { errors, warnings } = countBySeverity(found);
  if (errors === 0 && warnings === 0) return null;

  return (
    `\n\nLanguage server: ${errors} error(s), ${warnings} warning(s)\n` +
    formatDiagnostics(found, lsp.root, 10)
  );
}
