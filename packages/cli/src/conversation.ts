import type { Message } from '@plif/core';

export function withoutReasoning(messages: readonly Message[]): Message[] {
  return messages.map((message) => {
    if (message.reasoning === undefined) return message;
    const { reasoning, ...rest } = message;
    void reasoning;
    return rest;
  });
}
