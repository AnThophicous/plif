/** Terminal-window title helpers, kept pure so status labels are testable. */
export function titleForWorking(frame: string): string {
  void frame;
  return 'Plif-Code';
}

export function completedTitle(): string {
  return 'Plif-Code';
}

/** OSC 0 works in Windows Terminal, iTerm, and most modern terminal emulators. */
export function writeTerminalTitle(title: string, write: (chunk: string) => boolean = process.stdout.write.bind(process.stdout)): void {
  write(`\u001b]0;${title}\u0007`);
}
