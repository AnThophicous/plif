import type {
  SandboxTerminal,
  SpawnResult,
  TerminalOutput,
  TerminalSignal,
} from '@plif/sandbox';

export class TerminalSession {
  readonly id: string;
  readonly ownerId: string;
  readonly containerId: string;

  #terminal: SandboxTerminal;
  #redact: (text: string) => string;

  constructor(input: {
    terminal: SandboxTerminal;
    ownerId: string;
    containerId: string;
    redact: (text: string) => string;
  }) {
    this.#terminal = input.terminal;
    this.id = input.terminal.id;
    this.ownerId = input.ownerId;
    this.containerId = input.containerId;
    this.#redact = input.redact;
  }

  async write(input: string): Promise<void> {
    await this.#terminal.write(input);
  }

  async readAvailable(): Promise<readonly TerminalOutput[]> {
    return (await this.#terminal.readAvailable()).map((item) => ({
      ...item,
      chunk: this.#redact(item.chunk),
    }));
  }

  async *read(): AsyncGenerator<TerminalOutput> {
    for await (const item of this.#terminal.read()) {
      yield { ...item, chunk: this.#redact(item.chunk) };
    }
  }

  async resize(columns: number, rows: number): Promise<void> {
    await this.#terminal.resize(columns, rows);
  }

  async signal(signal: TerminalSignal): Promise<void> {
    await this.#terminal.signal(signal);
  }

  async wait(): Promise<SpawnResult> {
    const result = await this.#terminal.wait();
    return {
      ...result,
      stdout: this.#redact(result.stdout),
      stderr: this.#redact(result.stderr),
    };
  }

  async close(): Promise<void> {
    await this.#terminal.close();
  }
}
