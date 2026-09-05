import { BrowserSession } from './session.js';
import { spillLargeOutput } from '../harness/spill.js';
import type { Tool, ToolContext, ToolResult } from '../harness/tools.js';

export function browserTool(session = new BrowserSession()): Tool {
  return { spec: { name: 'browser', description: 'Use the isolated bundled browser. Open a URL, read visible text, click or type with a CSS selector, take a screenshot, inspect network-independent page state, or close the session.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['open','read','click','type','screenshot','close'] }, url: { type: 'string' }, selector: { type: 'string' }, text: { type: 'string' } }, required: ['action'], additionalProperties: false } }, async run(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = String(input.action ?? '');
    try {
      if (action === 'open') return { output: `Opened: ${await session.open(String(input.url ?? ''))}`, ok: true };
      if (action === 'read') return { output: await spillLargeOutput(await session.read(), 'browser-read', context.spill), ok: true };
      if (action === 'click') { await session.click(String(input.selector ?? '')); return { output: 'Clicked.', ok: true }; }
      if (action === 'type') { await session.type(String(input.selector ?? ''), String(input.text ?? '')); return { output: 'Typed.', ok: true }; }
      if (action === 'close') { await session.close(); return { output: 'Browser closed.', ok: true }; }
      return { output: 'Screenshot storage is not yet available in this runtime.', ok: false };
    } catch (error) { return { output: `Browser error: ${String(error)}`, ok: false }; }
  }};
}
export function browserTools(session?: BrowserSession): Tool[] { return [browserTool(session)]; }
