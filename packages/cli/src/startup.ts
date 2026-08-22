export const INTERACTIVE_CLEAR =
  // 3J removes the terminal's saved scrollback as well as the visible
  // viewport. npm and PowerShell print their lifecycle lines before Node
  // starts; without 3J those lines remain above the PLIF surface on Windows
  // Terminal even though 2J cleared the current screen.
  '\u001B[?1000l\u001B[?1002l\u001B[?1003l\u001B[?1006l\u001B[3J\u001B[2J\u001B[H';

interface StartupOutput {
  readonly isTTY?: boolean;
  readonly columns?: number;
  write(value: string): unknown;
}

export interface StartupIdentity {
  readonly version: string;
  readonly workspace: string;
  readonly width?: number;
}

function terminalWidth(value: number | undefined): number {
  if (!Number.isFinite(value)) return 80;
  return Math.max(1, Math.floor(value ?? 80));
}

function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, width: number): string {
  const characters = [...oneLine(value)];
  if (characters.length <= width) return characters.join('');
  if (width === 1) return '…';
  return `${characters.slice(0, width - 1).join('')}…`;
}

/** Two rows printed before slow startup work begins. */
export function renderStartupIdentity(identity: StartupIdentity): string {
  const width = terminalWidth(identity.width);
  return [
    truncate(`Plif ${identity.version}`, width),
    truncate(`workspace ${identity.workspace}`, width),
  ].join('\n') + '\n';
}

/**
 * Establish the normal terminal surface exactly once. This deliberately avoids
 * alternate-screen mode so Ink history remains in native scrollback.
 */
export function startInteractiveSurface(
  output: StartupOutput,
  identity: StartupIdentity,
): boolean {
  if (!output.isTTY) return false;
  output.write(INTERACTIVE_CLEAR);
  output.write(renderStartupIdentity({
    ...identity,
    width: identity.width ?? output.columns,
  }));
  return true;
}
