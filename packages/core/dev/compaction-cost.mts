/**
 * What the mechanical compaction stages actually recover.
 *
 * The ladder runs three mechanical stages before it will spend a model call,
 * so the number that matters is how much of a realistic transcript those three
 * remove on their own. A pass that reaches the model call every time is paying
 * for a summary it might not have needed.
 */
import { compact, estimateTokens } from '../src/harness/compaction.js';
import type { Message } from '../src/model/provider.js';

/**
 * What a spilled tool result looks like in the transcript.
 *
 * Spill writes the whole output to a file and puts a preview plus the path
 * into the context, so the session-wide question is how much smaller the
 * transcript is before compaction ever runs.
 */
function spilled(kind: string, lines: number, bytes: number): string {
  return (
    `first lines of the ${kind}\n...\nlast lines of the ${kind}\n\n` +
    `[Full output: ${lines} lines, ${bytes} characters, saved to /temp/spill/0001-${kind}.txt]\n` +
    'Nothing was lost. Use grep with a pattern on that path to find a specific part, ' +
    'or read_file to read it. Do not read the whole file unless you need all of it.'
  );
}

/** A session shaped like real work: reads, greps, edits, commands, answers. */
function transcript(turns: number, spill = false): Message[] {
  const messages: Message[] = [{ role: 'system', content: 'system prompt '.repeat(50) }];
  for (let i = 0; i < turns; i += 1) {
    messages.push({ role: 'user', content: `please look at module ${i} and fix the failing test` });
    messages.push({
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: `c${i}`, name: 'read_file', arguments: JSON.stringify({ path: `/project/src/mod${i}.ts` }) },
      ],
    });
    // The dominant cost in a real session: file contents and command output.
    const fileBody = Array.from(
      { length: 120 },
      (_, line) => `${line}\texport const value${line} = ${line};`,
    ).join('\n');
    messages.push({
      role: 'tool',
      toolCallId: `c${i}`,
      content: spill ? spilled('read', 120, fileBody.length) : fileBody,
    });
    messages.push({
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: `r${i}`, name: 'run_command', arguments: JSON.stringify({ argv: ['npm', 'test'] }) },
      ],
    });
    const commandBody = Array.from({ length: 80 }, (_, line) => `  at frame ${line}`).join('\n');
    messages.push({
      role: 'tool',
      toolCallId: `r${i}`,
      // The exit code stays inline either way; only the transcript spills.
      content: `exit 1\n${spill ? spilled('command', 80, commandBody.length) : commandBody}`,
    });
    messages.push({
      role: 'assistant',
      content: `Module ${i} is fixed; the assertion compared the wrong field.`,
    });
  }
  return messages;
}

async function report(label: string, messages: Message[], baseline?: number): Promise<number> {
  const before = estimateTokens(messages);
  // A budget the transcript clearly exceeds, so the ladder actually runs. No
  // provider is supplied, so it stops before the model call and reports what
  // the mechanical stages recovered on their own.
  const target = Math.round(50_412 * 0.35);
  const stages: string[] = [];
  const result = await compact(messages, { maxTokens: target, onStage: (stage) => stages.push(stage) });

  const share = (value: number): string => `${((value / before) * 100).toFixed(1)}%`;
  process.stdout.write(
    `
== ${label}
` +
      `  transcript      ${before.toLocaleString('en-US')} tokens (${messages.length} messages)` +
      `${baseline ? `  — ${(100 - (before / baseline) * 100).toFixed(1)}% smaller than baseline` : ''}
` +
      `  budget          ${target.toLocaleString('en-US')} tokens
` +
      `  after mechanics ${result.after.toLocaleString('en-US')} tokens (${share(result.after)})
` +
      `  recovered       ${(before - result.after).toLocaleString('en-US')} tokens
` +
      `  stages run      ${stages.length}
` +
      `  reached budget  ${result.after <= target ? 'yes — no model call needed' : 'NO — a model call would be needed'}
`,
  );
  return before;
}

const baseline = await report('without spill (how plif behaved before)', transcript(40));
await report('with spill (how it behaves now)', transcript(40, true), baseline);
