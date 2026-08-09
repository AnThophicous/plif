import process from 'node:process';

const ESCAPE = '\u001b';
const ENABLE = `${ESCAPE}[?2004h`;
const DISABLE = `${ESCAPE}[?2004l`;
const BEGIN = `${ESCAPE}[200~`;
const END = `${ESCAPE}[201~`;
const CARRY = END.length - 1;
const MAX_OPEN = 1_000_000;

export interface PasteState {
  readonly open: boolean;
  readonly buffer: string;
}

export interface InputSegment {
  readonly pasted: boolean;
  readonly text: string;
}

export interface PasteRead {
  readonly state: PasteState;
  readonly segments: readonly InputSegment[];
}

export const IDLE_PASTE: PasteState = { open: false, buffer: '' };

let active = false;
let restoreOnExit = false;

export function enableBracketedPaste(stream: NodeJS.WriteStream = process.stdout): void {
  if (active || !stream.isTTY) return;
  stream.write(ENABLE);
  active = true;
  if (!restoreOnExit) {
    restoreOnExit = true;
    process.on('exit', () => disableBracketedPaste(stream));
  }
}

export function disableBracketedPaste(stream: NodeJS.WriteStream = process.stdout): void {
  if (!active) return;
  active = false;
  stream.write(DISABLE);
}

function withEscape(chunk: string): string {
  return chunk.startsWith(BEGIN.slice(1)) || chunk.startsWith(END.slice(1))
    ? ESCAPE + chunk
    : chunk;
}

export function hasPasteMarker(chunk: string): boolean {
  return withEscape(chunk).includes(BEGIN);
}

export function readPasteChunk(state: PasteState, chunk: string): PasteRead {
  const segments: InputSegment[] = [];
  let open = state.open;
  let held = open ? state.buffer.slice(0, -CARRY) : '';
  let rest = (open ? state.buffer.slice(-CARRY) : '') + withEscape(chunk);

  while (rest.length > 0) {
    if (open) {
      const end = rest.indexOf(END);
      if (end === -1) break;
      segments.push({ pasted: true, text: held + rest.slice(0, end) });
      held = '';
      open = false;
      rest = rest.slice(end + END.length);
      continue;
    }

    const begin = rest.indexOf(BEGIN);
    if (begin === -1) {
      segments.push({ pasted: false, text: rest });
      rest = '';
      break;
    }
    if (begin > 0) segments.push({ pasted: false, text: rest.slice(0, begin) });
    open = true;
    rest = rest.slice(begin + BEGIN.length);
  }

  if (!open) return { state: IDLE_PASTE, segments };

  const pending = held + rest;
  if (pending.length > MAX_OPEN) {
    segments.push({ pasted: true, text: pending });
    return { state: IDLE_PASTE, segments };
  }
  return { state: { open: true, buffer: pending }, segments };
}
