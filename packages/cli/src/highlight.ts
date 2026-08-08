/**
 * Syntax colouring, for one line at a time.
 *
 * Deliberately a tokeniser and not a parser. A diff hands over individual
 * lines torn out of their context — half a template literal, the middle of a
 * block comment, a line that opens a string and does not close it — and any
 * approach that needs to understand the file will get those wrong in a way
 * that looks like a bug in the diff rather than a limit of the highlighter.
 *
 * A regex scan degrades honestly instead: the worst case is a line coloured as
 * plain code, which is what an uncoloured terminal shows anyway.
 *
 * The palette is deliberately narrow — five tones out of the existing theme,
 * not a new set. Colour here has to compete with the red and green of the diff
 * background, and a highlighter using twelve hues would win that fight and make
 * the change itself harder to see, which is backwards.
 */

import type { PaletteKey } from './theme.js';

export interface Token {
  readonly text: string;
  readonly tone: PaletteKey;
}

const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  ts: [
    'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for',
    'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
    'keyof', 'let', 'new', 'of', 'private', 'protected', 'public', 'readonly', 'return',
    'satisfies', 'set', 'static', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof',
    'var', 'void', 'while', 'yield',
  ],
  py: [
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
    'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
    'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  ],
  go: [
    'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
    'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
    'return', 'select', 'struct', 'switch', 'type', 'var',
  ],
  rs: [
    'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum',
    'extern', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut',
    'pub', 'ref', 'return', 'self', 'static', 'struct', 'super', 'trait', 'type', 'unsafe',
    'use', 'where', 'while',
  ],
  sh: [
    'case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in', 'local',
    'return', 'then', 'until', 'while',
  ],
};

const LITERALS = ['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil'];

const COMMENT_PREFIX: Readonly<Record<string, readonly string[]>> = {
  ts: ['//', '/*', '*/', '*'],
  py: ['#'],
  go: ['//'],
  rs: ['//'],
  sh: ['#'],
  json: [],
  md: [],
};

/** Which rule set a path uses. Unknown extensions get the plain treatment. */
export function languageOf(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path.toLowerCase())?.[1] ?? '';
  switch (extension) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mts':
    case 'mjs':
    case 'cjs':
      return 'ts';
    case 'py':
      return 'py';
    case 'go':
      return 'go';
    case 'rs':
      return 'rs';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'sh';
    case 'json':
    case 'jsonc':
      return 'json';
    case 'md':
      return 'md';
    default:
      return 'plain';
  }
}

/**
 * One line, split into coloured runs.
 *
 * Always returns at least one token covering the whole line, so a caller can
 * concatenate the texts and get the input back unchanged. That property is
 * what makes it safe to run over a diff: colouring can never alter what the
 * developer is shown, only how it looks.
 */
export function highlight(line: string, language: string): Token[] {
  if (!line) return [{ text: '', tone: 'text' }];
  if (language === 'plain' || language === 'md') return [{ text: line, tone: 'text' }];

  const comments = COMMENT_PREFIX[language] ?? [];
  const keywords = new Set(KEYWORDS[language] ?? []);

  // A whole-line comment is the one case worth special-casing, because it is
  // the one where tokenising the contents produces obvious nonsense — every
  // English word in a sentence lit up as an identifier.
  const trimmed = line.trimStart();
  if (comments.some((prefix) => trimmed.startsWith(prefix))) {
    return [{ text: line, tone: 'faint' }];
  }

  const tokens: Token[] = [];
  let index = 0;

  const push = (text: string, tone: PaletteKey): void => {
    const last = tokens[tokens.length - 1];
    if (last && last.tone === tone) tokens[tokens.length - 1] = { text: last.text + text, tone };
    else tokens.push({ text, tone });
  };

  while (index < line.length) {
    const rest = line.slice(index);

    // Trailing comment.
    const comment = comments.find((prefix) => prefix.length > 1 && rest.startsWith(prefix));
    if (comment || (comments.includes('#') && rest.startsWith('#'))) {
      push(rest, 'faint');
      break;
    }

    // Strings, including the unterminated kind a diff line ends in.
    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      let end = 1;
      while (end < rest.length) {
        if (rest[end] === '\\') end += 2;
        else if (rest[end] === quote) {
          end += 1;
          break;
        } else end += 1;
      }
      push(rest.slice(0, end), 'success');
      index += end;
      continue;
    }

    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest)?.[0];
    if (word) {
      const tone: PaletteKey = keywords.has(word)
        ? 'accent'
        : LITERALS.includes(word)
          ? 'warn'
          : // A name immediately followed by `(` is being called, and calls are
            // the landmarks a reader scans a diff for.
            /^\s*\(/.test(rest.slice(word.length))
            ? 'info'
            : 'text';
      push(word, tone);
      index += word.length;
      continue;
    }

    const number = /^0[xXbBoO][0-9a-fA-F_]+|^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?/.exec(rest)?.[0];
    if (number) {
      push(number, 'warn');
      index += number.length;
      continue;
    }

    push(rest[0] as string, /[{}()[\].,;:]/.test(rest[0] as string) ? 'muted' : 'text');
    index += 1;
  }

  return tokens.length ? tokens : [{ text: line, tone: 'text' }];
}
