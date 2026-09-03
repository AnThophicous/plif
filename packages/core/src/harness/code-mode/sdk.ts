/**
 * The generated SDK: in Code Mode the prompt is source code.
 *
 * In the native presentation every tool ships its JSON Schema on the wire, on
 * every request, forever. Here the whole catalogue is projected once into a
 * TypeScript declaration block that lives in the *system prompt* — the stable
 * prefix a provider can cache — and only `run_code` stays on the wire. For a
 * thirty-tool session that turns a per-request schema payload into a cached
 * prefix, and it is where most of Code Mode's saving actually comes from.
 *
 * The projection is therefore required to be byte-identical for the same tool
 * set: names are emitted in lexicographic order, object keys in schema order,
 * and nothing in here reads the clock, the filesystem or a random source. A
 * rendering that varied between turns would invalidate the cache it exists to
 * fill.
 */

import type { ToolSpec } from '../../model/provider.js';

export const RUN_CODE_TOOL_NAME = 'run_code';

/**
 * How deep a parameter schema is projected before it collapses to `JsonValue`.
 *
 * Tool schemas are hand-written and shallow; a schema deeper than this is
 * either generated or adversarial, and either way the model is better served by
 * an honest `JsonValue` than by a wall of nesting it has to parse. The cap is
 * also what keeps the projection stack-safe against a self-referential schema.
 */
const MAX_SCHEMA_DEPTH = 8;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const JSON_VALUE_DECLARATION = [
  'type JsonValue =',
  '  | string | number | boolean | null',
  '  | JsonValue[]',
  '  | { [key: string]: JsonValue };',
].join('\n');

/**
 * The rule the model has to read before the catalogue, not after it.
 *
 * Placed early in the prompt because a model that meets thirty tool names first
 * will try to call one, and the denial it gets back costs a whole turn to learn
 * something one sentence could have told it.
 */
export const CODE_MODE_COLLAPSE_NOTICE =
  '`run_code` is the only tool you can call directly. A tool call naming any other tool ' +
  'fails before it runs. Reach every tool declared in the SDK below from inside the program.';

const SDK_INSTRUCTIONS = [
  '## Writing code for run_code',
  '',
  'You write the *body* of an async function. Top-level `await` and `return` both work.',
  'Type annotations are erased before execution, so they are advisory: they help you write',
  'correct calls, they are not checked at runtime.',
  '',
  '- Call a tool with `await tools.<name>({ ...args })`. The arguments are the same JSON',
  '  the native tool call would take.',
  '- A tool that fails throws `ToolCallError`, carrying `toolName` and `output`. Use',
  '  `try { ... } catch (error) { ... }` for a failure you expect. An unhandled throw ends',
  '  the program and you get the error plus everything logged before it.',
  '- Independent calls should run together: `const [a, b] = await Promise.all([...])`.',
  '  Calls that depend on each other stay sequential.',
  '- `console.log(...)` is your transcript and `return` is your result. Only those two',
  '  reach the conversation — the individual tool outputs do not, and that is the point:',
  '  read ten files, return the three lines that mattered.',
  '- Keep each program small and specific. Two focused programs cost less than one that',
  '  guesses what it might need.',
  '',
  'The available tools:',
].join('\n');

interface SchemaLike {
  readonly [key: string]: unknown;
}

function asRecord(value: unknown): SchemaLike | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as SchemaLike)
    : undefined;
}

function literal(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return 'JsonValue';
}

function primitive(type: string): string {
  switch (type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return 'JsonValue[]';
    case 'object':
      return '{ [key: string]: JsonValue }';
    default:
      return 'JsonValue';
  }
}

function unique(members: readonly string[]): string[] {
  return [...new Set(members)];
}

/**
 * Collapse a description to one line.
 *
 * Tool descriptions are prose with newlines, and a JSDoc comment that kept them
 * would render differently depending on how the description happened to wrap —
 * exactly the instability a cached prefix cannot have. Closing a block comment
 * inside a description would also end the declaration early, so that sequence
 * is neutralised rather than trusted.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').split('*/').join('*\\/').trim();
}

/**
 * Project one JSON Schema node into a TypeScript type.
 *
 * Deliberately partial. The projection covers what tool schemas actually use —
 * objects, arrays, enums, unions, primitives — and everything else degrades to
 * `JsonValue` rather than to a guess. A wrong type here reads to the model as a
 * contract, and it would then write to that contract instead of to the tool.
 */
function projectType(schema: unknown, depth: number, indent: string): string {
  const node = asRecord(schema);
  if (!node || depth > MAX_SCHEMA_DEPTH) return 'JsonValue';

  const constant = node['const'];
  if (constant !== undefined) return literal(constant);

  const enumeration = node['enum'];
  if (Array.isArray(enumeration) && enumeration.length > 0) {
    return unique(enumeration.map(literal)).join(' | ');
  }

  for (const key of ['oneOf', 'anyOf'] as const) {
    const branches = node[key];
    if (Array.isArray(branches) && branches.length > 0) {
      return unique(branches.map((branch) => projectType(branch, depth + 1, indent))).join(' | ');
    }
  }

  const type = node['type'];
  if (Array.isArray(type)) {
    return unique(
      type.map((entry) => (typeof entry === 'string' ? primitive(entry) : 'JsonValue')),
    ).join(' | ');
  }

  if (type === 'array') {
    const items = projectType(node['items'], depth + 1, indent);
    return IDENTIFIER.test(items) || items.endsWith('[]') ? `${items}[]` : `(${items})[]`;
  }

  if (type === 'object' || asRecord(node['properties'])) {
    return projectObject(node, depth, indent);
  }

  return typeof type === 'string' ? primitive(type) : 'JsonValue';
}

function projectObject(node: SchemaLike, depth: number, indent: string): string {
  const properties = asRecord(node['properties']);
  if (!properties || Object.keys(properties).length === 0) {
    return '{ [key: string]: JsonValue }';
  }

  const required = new Set(
    (Array.isArray(node['required']) ? node['required'] : []).filter(
      (name): name is string => typeof name === 'string',
    ),
  );
  const inner = `${indent}  `;
  const lines: string[] = ['{'];
  for (const [name, raw] of Object.entries(properties)) {
    const field = asRecord(raw);
    const description = typeof field?.['description'] === 'string' ? field['description'] : '';
    if (description) lines.push(`${inner}/** ${oneLine(description)} */`);
    const key = IDENTIFIER.test(name) ? name : JSON.stringify(name);
    const optional = required.has(name) ? '' : '?';
    lines.push(`${inner}${key}${optional}: ${projectType(raw, depth + 1, inner)};`);
  }
  lines.push(`${indent}}`);
  const rendered = lines.join('\n');
  return node['additionalProperties'] === false
    ? rendered
    : `${rendered} & { [key: string]: JsonValue }`;
}

/**
 * Render the TypeScript SDK for a tool set.
 *
 * `run_code` itself is excluded: a program able to call `run_code` could nest
 * runs, and the model gains nothing from a second scheduler to reason about.
 */
export function renderToolsSdk(specs: readonly ToolSpec[]): string {
  const catalogue = [...specs]
    .filter((spec) => spec.name !== RUN_CODE_TOOL_NAME)
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  if (catalogue.length === 0) return '';

  const args = catalogue.map((spec) => {
    const key = IDENTIFIER.test(spec.name) ? spec.name : JSON.stringify(spec.name);
    const description = oneLine(spec.description);
    const type = projectType(spec.parameters, 0, '  ');
    return `${description ? `  /** ${description} */\n` : ''}  ${key}: ${type};`;
  });

  return [
    SDK_INSTRUCTIONS,
    '',
    '```ts',
    JSON_VALUE_DECLARATION,
    '',
    '/** What every tool resolves to. `ok` is always true here: a failure throws. */',
    'interface ToolCallResult {',
    '  ok: true;',
    '  /** The tool result, exactly as the native presentation would have shown it. */',
    '  output: string;',
    '  /** A unified diff, when the call changed a file. */',
    '  diff?: string;',
    '}',
    '',
    'interface ToolArgsMap {',
    ...args,
    '}',
    '',
    'type ToolName = keyof ToolArgsMap;',
    '',
    'declare class ToolCallError extends Error {',
    '  readonly toolName: ToolName;',
    '  /** The failing tool’s own message, for a program that recovers from it. */',
    '  readonly output: string;',
    '}',
    '',
    'declare const tools: {',
    '  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolCallResult>;',
    '};',
    '```',
  ].join('\n');
}
