import { detectShell, shellSection } from '../harness/environment.js';
import { definePromptModule } from './types.js';
import type { PromptContext } from './types.js';

export const environmentModule = definePromptModule({
  id: '50-environment',
  order: 50,
  render: (context) => {
    const names = new Set(context.tools?.map((tool) => tool.name) ?? []);
    const lines = [
      '# Runtime and environment',
      '',
      `- host workspace: ${context.workspace}`,
      `- Plif container: ${context.containerName}, ${context.isolation} isolation`,
      `- project working directory inside the container: ${context.workdir}`,
      `- allowed capabilities: ${grants(context)}`,
      `- unavailable capabilities: ${denials(context)}`,
    ];

    const fileTools = ['read_file', 'write_file', 'edit_file', 'list_dir'].filter((name) => names.has(name));
    const hasLsp = [...names].some((name) => name.startsWith('lsp_'));
    if (fileTools.length > 0 || hasLsp) {
      const consumers = [...fileTools, ...(hasLsp ? ['lsp tools'] : [])].join(', ');
      lines.push(
        '',
        'Plif exposes two path spaces. Do not mix them:',
        `- ${consumers} take absolute container paths such as ${context.workdir}/src/index.ts.`,
        '- Never pass those tools a host path or an unresolved relative path.',
      );
    }

    if (names.has('run_command')) {
      lines.push(
        '- run_command starts inside the project but executes a real host process. Pass',
        '  project-relative paths such as src/index.ts, not container-prefixed paths.',
      );
    }

    if (!context.capabilities.hostWrite && context.capabilities.fsWrite) {
      lines.push(
        '',
        'Filesystem writes land in the container layer rather than directly on the host.',
        'This is permission to work inside the project, not permission for unrelated changes.',
      );
    }

    if (context.sandboxGaps?.length) {
      lines.push(
        '',
        'Known sandbox enforcement gaps:',
        ...context.sandboxGaps.map((gap) => `- ${gap}`),
        '',
        'These gaps do not grant authority. Apply the declared permission boundary even',
        'when the operating system would technically allow a bypass.',
      );
    }

    lines.push('', shellSection(context.shell ?? detectShell(), context.capabilities.envRead));
    return lines.join('\n');
  },
});

function grants(context: PromptContext): string {
  const allowed: string[] = [];
  if (context.capabilities.fsRead) allowed.push('read project files');
  if (context.capabilities.fsWrite) allowed.push('write container files');
  if (context.capabilities.hostWrite) allowed.push('write through to the host');
  if (context.capabilities.exec) allowed.push('run processes');
  if (context.capabilities.network) allowed.push('use the network');
  if (context.capabilities.spawnContainers) allowed.push('spawn child containers');
  return allowed.length > 0 ? allowed.join(', ') : 'none';
}

function denials(context: PromptContext): string {
  const denied: string[] = [];
  if (!context.capabilities.fsRead) denied.push('file reads');
  if (!context.capabilities.fsWrite) denied.push('container writes');
  if (!context.capabilities.hostWrite) denied.push('host writes');
  if (!context.capabilities.exec) denied.push('process execution');
  if (!context.capabilities.network) denied.push('network access and package installation');
  if (!context.capabilities.spawnContainers) denied.push('child containers');
  return denied.length > 0 ? denied.join(', ') : 'none';
}

