import type { SyntaxKey } from './theme.js';

export interface ShellToken {
  readonly text: string;
  readonly kind: SyntaxKey;
}

/** Tokenize an embedded command without ever changing its text. */
export function highlightShell(command: string): ShellToken[] {
  if (!command) return [{ text: '', kind: 'plain' }];
  const powershell = /(?:^|\s)(?:Get|Set|New|Remove|Select|Where|ForEach|Write|Invoke|Start|Stop)-[A-Za-z]+|\$[A-Za-z_{]/.test(command);
  const tokens: ShellToken[] = [];
  let at = 0;
  let wordIndex = 0;

  const push = (text: string, kind: SyntaxKey): void => {
    const previous = tokens.at(-1);
    if (previous?.kind === kind) tokens[tokens.length - 1] = { text: previous.text + text, kind };
    else tokens.push({ text, kind });
  };

  while (at < command.length) {
    const rest = command.slice(at);
    const whitespace = /^\s+/.exec(rest)?.[0];
    if (whitespace) { push(whitespace, 'plain'); at += whitespace.length; continue; }

    if (rest.startsWith('#')) { push(rest, 'comment'); break; }
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      let end = 1;
      while (end < rest.length) {
        if (rest[end] === (powershell ? '`' : '\\')) end += 2;
        else if (rest[end] === quote) { end += 1; break; }
        else end += 1;
      }
      push(rest.slice(0, end), 'string'); at += end; wordIndex += 1; continue;
    }

    const variable = powershell ? /^\$\{?[-A-Za-z0-9_:]+\}?/.exec(rest)?.[0] : /^\$\{?[-A-Za-z0-9_@*#$?!]+\}?/.exec(rest)?.[0];
    if (variable) { push(variable, 'variable'); at += variable.length; continue; }
    const operator = /^(?:\|\||&&|2?>|>>|[|;=<>()[\]{}])/.exec(rest)?.[0];
    if (operator) { push(operator, 'operator'); at += operator.length; wordIndex = operator === '|' || operator === ';' ? 0 : wordIndex; continue; }
    const parameter = /^--?[A-Za-z][A-Za-z0-9-]*(?::[A-Za-z]+)?/.exec(rest)?.[0];
    if (parameter) { push(parameter, 'parameter'); at += parameter.length; wordIndex += 1; continue; }
    const number = /^\d+(?:\.\d+)?/.exec(rest)?.[0];
    if (number) { push(number, 'number'); at += number.length; wordIndex += 1; continue; }
    const word = /^[^\s|;&=<>()[\]{}]+/.exec(rest)?.[0];
    if (word) {
      const isCommand = wordIndex === 0 || (powershell && /^[A-Z][a-z]+-[A-Z]/.test(word));
      push(word, isCommand ? 'command' : 'plain'); at += word.length; wordIndex += 1; continue;
    }
    push(rest[0]!, 'plain'); at += 1;
  }
  return tokens;
}
