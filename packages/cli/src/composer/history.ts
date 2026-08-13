export interface HistoryLookup {
  previous(before: number): Promise<{ readonly index: number; readonly text: string } | null>;
  search(
    query: string,
    before: number,
  ): Promise<{ readonly index: number; readonly text: string } | null>;
}

export interface HistoryRecord {
  readonly index: number;
  readonly text: string;
}

/** Current-session recall plus a lazy boundary for older persisted input. */
export class ComposerHistory {
  #entries: string[] = [];
  #position = -1;
  #draft = '';
  #lookup: HistoryLookup | undefined;
  #persistent = new Map<number, string>();

  constructor(lookup?: HistoryLookup) {
    this.#lookup = lookup;
  }

  get size(): number {
    return this.#entries.length;
  }

  record(text: string): void {
    if (!text.trim()) return;
    if (this.#entries[this.#entries.length - 1] !== text) this.#entries.push(text);
    this.resetRecall();
  }

  previous(currentDraft: string): string {
    if (this.#entries.length === 0) return currentDraft;
    if (this.#position === -1) {
      this.#draft = currentDraft;
      this.#position = this.#entries.length - 1;
    } else {
      this.#position = Math.max(0, this.#position - 1);
    }
    return this.#entries[this.#position] ?? currentDraft;
  }

  next(currentDraft: string): string {
    if (this.#position === -1) return currentDraft;
    if (this.#position < this.#entries.length - 1) {
      this.#position += 1;
      return this.#entries[this.#position] ?? currentDraft;
    }
    const draft = this.#draft;
    this.resetRecall();
    return draft;
  }

  search(query: string, before = -1): string | null {
    if (!query) return null;
    const start = before < 0
      ? this.#entries.length - 1
      : Math.min(this.#entries.length - 1, before - 1);
    for (let index = start; index >= 0; index -= 1) {
      const text = this.#entries[index];
      if (text?.includes(query)) return text;
    }
    return null;
  }

  async fetchPrevious(before: number): Promise<HistoryRecord | null> {
    const cached = this.#cachedBefore(before);
    if (cached) return cached;
    if (!this.#lookup) return null;
    return this.#remember(await this.#lookup.previous(before));
  }

  async fetchSearch(query: string, before: number): Promise<HistoryRecord | null> {
    const cached = [...this.#persistent]
      .filter(([index, text]) => index < before && text.includes(query))
      .sort(([left], [right]) => right - left)[0];
    if (cached) return { index: cached[0], text: cached[1] };
    if (!this.#lookup) return null;
    return this.#remember(await this.#lookup.search(query, before));
  }

  resetRecall(): void {
    this.#position = -1;
    this.#draft = '';
  }

  #cachedBefore(before: number): HistoryRecord | null {
    const cached = [...this.#persistent]
      .filter(([index]) => index < before)
      .sort(([left], [right]) => right - left)[0];
    return cached ? { index: cached[0], text: cached[1] } : null;
  }

  #remember(record: HistoryRecord | null): HistoryRecord | null {
    if (!record || !record.text.trim()) return null;
    this.#persistent.set(record.index, record.text);
    return record;
  }
}
