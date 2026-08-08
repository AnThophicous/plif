import path from 'node:path';

import type { Tool, ToolContext, ToolResult } from '../harness/tools.js';
import { countBySeverity, formatDiagnostics } from './manager.js';
import type { LspManager } from './manager.js';

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
        'it follows imports and re-exports, and it does not match comments.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Container-absolute path' },
          line: { type: 'number', description: '1-based line of the symbol' },
          column: { type: 'number', description: '1-based column of the symbol' },
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

      const locations = await client.definition(file, line, column);
      if (locations.length === 0) {
        return { output: 'No definition found at that position.', ok: false };
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
        'finds callers a grep for the name would miss or over-report.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Container-absolute path' },
          line: { type: 'number', description: '1-based line of the symbol' },
          column: { type: 'number', description: '1-based column of the symbol' },
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

export function lspTools(lsp: LspManager): Tool[] {
  return [diagnosticsTool(lsp), definitionTool(lsp), referencesTool(lsp), outlineTool(lsp)];
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
