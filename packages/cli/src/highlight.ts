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

import type { SyntaxKey } from './theme.js';

export interface Token {
  readonly text: string;
  readonly kind: SyntaxKey;
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
  cpp: [
    'alignas', 'alignof', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class',
    'const', 'constexpr', 'continue', 'default', 'delete', 'do', 'double', 'else', 'enum',
    'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'if', 'inline',
    'int', 'long', 'namespace', 'new', 'noexcept', 'nullptr', 'operator', 'private',
    'protected', 'public', 'return', 'short', 'signed', 'sizeof', 'static', 'struct',
    'switch', 'template', 'this', 'throw', 'true', 'try', 'typedef', 'typename',
    'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'while',
  ],
};

const LITERALS = ['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil'];

const COMMENT_PREFIX: Readonly<Record<string, readonly string[]>> = {
  ts: ['//', '/*', '*/', '*'],
  py: ['#'],
  go: ['//'],
  rs: ['//'],
  sh: ['#'],
  cpp: ['//', '/*', '*/', '*'],
  json: ['//', '/*', '*/', '*'],
  toml: ['#'],
  css: ['/*', '*/', '*'],
  html: ['<!--', '-->'],
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
    case 'ps1':
    case 'psm1':
    case 'psd1':
      return 'sh';
    case 'c':
    case 'h':
    case 'cc':
    case 'cpp':
    case 'hpp':
    case 'cxx':
      return 'cpp';
    case 'json':
    case 'jsonc':
      return 'json';
    case 'toml':
      return 'toml';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
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
  if (!line) return [{ text: '', kind: 'plain' }];
  if (language === 'plain' || language === 'md') return [{ text: line, kind: 'plain' }];

  const comments = COMMENT_PREFIX[language] ?? [];
  const keywords = new Set(KEYWORDS[language] ?? []);

  // A whole-line comment is the one case worth special-casing, because it is
  // the one where tokenising the contents produces obvious nonsense — every
  // English word in a sentence lit up as an identifier.
  const trimmed = line.trimStart();
  if (comments.some((prefix) => prefix !== '*' && trimmed.startsWith(prefix))) {
    return [{ text: line, kind: 'comment' }];
  }

  const tokens: Token[] = [];
  let index = 0;

  const push = (text: string, kind: SyntaxKey): void => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) tokens[tokens.length - 1] = { text: last.text + text, kind };
    else tokens.push({ text, kind });
  };

  while (index < line.length) {
    const rest = line.slice(index);

    // Trailing comment.
    const comment = comments.find((prefix) => prefix !== '*' && rest.startsWith(prefix));
    if (comment || (comments.includes('#') && rest.startsWith('#'))) {
      push(rest, 'comment');
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
      push(rest.slice(0, end), 'string');
      index += end;
      continue;
    }

    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest)?.[0];
    if (word) {
      const before = line.slice(0, index);
      const after = rest.slice(word.length);
      const kind: SyntaxKey = keywords.has(word) || LITERALS.includes(word)
        ? 'keyword'
        : language === 'toml' && /^\s*=/.test(after)
          ? 'property'
          : language === 'css' && /^\s*:/.test(after)
            ? 'property'
            : /(?:\.|\?\.)$/.test(before)
              ? 'property'
              : /<\/?$/.test(before) || /^[A-Z]/.test(word)
                ? 'type'
                : /^\s*\(/.test(after)
                  ? 'function'
                  : 'variable';
      push(word, kind);
      index += word.length;
      continue;
    }

    const number = /^0[xXbBoO][0-9a-fA-F_]+|^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?/.exec(rest)?.[0];
    if (number) {
      push(number, 'number');
      index += number.length;
      continue;
    }

    const operator = /^(?:=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|\*\*|[=+\-*/%<>!&|^~?:{}()[\].,;])/.exec(rest)?.[0];
    if (operator) {
      push(operator, 'operator');
      index += operator.length;
      continue;
    }

    push(rest[0] as string, 'plain');
    index += 1;
  }

  return tokens.length ? tokens : [{ text: line, kind: 'plain' }];
}
