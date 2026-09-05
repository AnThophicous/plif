import { BrowserSession, type BrowserHost, type NetworkEntry } from './session.js';
import { spillLargeOutput } from '../harness/spill.js';
import type { Tool, ToolContext, ToolResult } from '../harness/tools.js';

/**
 * Running arbitrary script in the page is a different power from driving it.
 *
 * click and type can only do what a person sitting at the page could do. eval
 * can read every token the page holds, rewrite its state, and call anything it
 * has loaded — on a page the model chose to open, whose contents are untrusted
 * by definition. So it asks, it defaults to no, and a silence or a timeout is a
 * no rather than a yes.
 */
async function allowEvaluate(context: ToolContext, expression: string): Promise<boolean> {
  const answer = await context.questions
    .ask({
      text: 'Run this script inside the browser page?',
      context: expression.length > 400 ? `${expression.slice(0, 400)}…` : expression,
      options: [
        { value: 'no', label: 'No, this turn only' },
        { value: 'yes', label: 'Yes, run it' },
        { value: 'always', label: 'Yes, and stop asking this session' },
      ],
    })
    .catch(() => null);
  return answer === 'yes' || answer === 'always';
}

function formatNetwork(entries: readonly NetworkEntry[]): string {
  if (entries.length === 0) return 'No requests recorded since the browser opened.';
  return entries
    .map((entry) => {
      const status = entry.status === undefined ? '   ' : String(entry.status).padStart(3);
      const type = entry.mimeType ? `  ${entry.mimeType}` : '';
      return `${status} ${entry.method.padEnd(6)} ${entry.url}${type}`;
    })
    .join('\n');
}

export function browserTool(session = new BrowserSession()): Tool {
  // Remembered for the session, not for the process: an approval given once for
  // one page's script is not an approval for every page opened afterwards, but
  // re-asking on every call of a loop the operator already approved is noise.
  let evaluateAlwaysAllowed = false;

  return {
    spec: {
      name: 'browser',
      description:
        'Drive the isolated bundled browser through CDP. It runs under PLIF terminal ' +
        'policy, and its profile and artifacts live under /temp. Use read for the page ' +
        'text, network for what the page called, and eval only when driving the page ' +
        'cannot answer the question — eval asks the operator first.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['open', 'read', 'click', 'type', 'screenshot', 'network', 'eval', 'close'],
          },
          url: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
          expression: { type: 'string', description: 'JavaScript to run in the page, for eval' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const action = String(input.action ?? '');
      try {
        if (action === 'open') {
          return {
            output: `Opened: ${await session.open(context.container as unknown as BrowserHost, String(input.url ?? ''))}`,
            ok: true,
          };
        }
        if (action === 'read') {
          return { output: await spillLargeOutput(await session.read(), 'browser-read', context.spill), ok: true };
        }
        if (action === 'click') {
          await session.click(String(input.selector ?? ''));
          return { output: 'Clicked.', ok: true };
        }
        if (action === 'type') {
          await session.type(String(input.selector ?? ''), String(input.text ?? ''));
          return { output: 'Typed.', ok: true };
        }
        if (action === 'network') {
          return {
            output: await spillLargeOutput(formatNetwork(session.network()), 'browser-network', context.spill),
            ok: true,
          };
        }
        if (action === 'eval') {
          const expression = typeof input.expression === 'string' ? input.expression.trim() : '';
          if (!expression) return { output: 'eval needs an expression to run.', ok: false };
          if (!evaluateAlwaysAllowed && !(await allowEvaluate(context, expression))) {
            return { output: 'Running script in the page was not approved. Nothing ran.', ok: false };
          }
          evaluateAlwaysAllowed = true;
          const value = await session.evaluate(expression);
          const rendered = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
          return { output: await spillLargeOutput(rendered, 'browser-eval', context.spill), ok: true };
        }
        if (action === 'screenshot') {
          const stamp = Date.now();
          const encoded = await session.screenshot();
          // The container writes UTF-8, so the bytes cannot go through it. The
          // page that carries them can: an HTML file with the image inlined
          // opens as a picture, which is what someone asking for a screenshot
          // wanted, while the .b64 beside it stays machine-readable.
          const data = `/temp/spill/browser-${stamp}.png.b64`;
          const viewer = `/temp/spill/browser-${stamp}.html`;
          await context.container.writeFile(data, encoded);
          await context.container.writeFile(
            viewer,
            `<!doctype html><meta charset="utf-8"><title>browser-${stamp}</title>` +
              `<img src="data:image/png;base64,${encoded}" style="max-width:100%">`,
          );
          return {
            output: `Screenshot saved.\n  ${viewer}   open this one to look at it\n  ${data}   base64 PNG`,
            ok: true,
          };
        }
        if (action === 'close') {
          await session.close();
          return { output: 'Browser closed.', ok: true };
        }
        return { output: `Unknown browser action "${action}".`, ok: false };
      } catch (error) {
        return { output: `Browser error: ${String(error)}`, ok: false };
      }
    },
  };
}

export function browserTools(session?: BrowserSession): Tool[] {
  return [browserTool(session)];
}
