/**
 * Reconcile a provider's explicit streaming contract into visible deltas.
 *
 * OpenAI-compatible endpoints normally send incremental `delta.content`.
 * Some gateways instead repeat the complete answer-so-far, and some append a
 * complete final message after the deltas. These are different protocols and
 * must be declared by the adapter; guessing from the text would erase
 * legitimate repeated words such as "Asp Asp".
 */
export type ContentSemantics = 'delta' | 'snapshot';

export interface ContentObservation {
  readonly text: string;
  readonly semantics: ContentSemantics;
}

export class ContentProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentProtocolError';
  }
}

export class ContentDeltaNormalizer {
  #value = '';

  get value(): string {
    return this.#value;
  }

  push(input: string | ContentObservation): string {
    const observation: ContentObservation = typeof input === 'string'
      ? { text: input, semantics: 'delta' }
      : input;
    if (!observation.text) return '';

    if (observation.semantics === 'delta') {
      this.#value += observation.text;
      return observation.text;
    }

    if (observation.text === this.#value) return '';
    if (observation.text.startsWith(this.#value)) {
      const delta = observation.text.slice(this.#value.length);
      this.#value = observation.text;
      return delta;
    }

    throw new ContentProtocolError(
      'provider changed a cumulative content snapshot instead of extending it',
    );
  }
}
