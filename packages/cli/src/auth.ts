import type { McpAuthEvent } from '@plif/core';

export interface AuthNotice {
  readonly title: string;
  readonly subtitle: string;
  readonly detail?: string;
  readonly tone: 'accent' | 'muted' | 'warn' | 'danger' | 'success';
  readonly status?: 'active' | 'done' | 'failed';
}

function withUrl(event: McpAuthEvent): { detail?: string } {
  const lines = [event.detail, event.authorizationUrl].filter(Boolean);
  return lines.length ? { detail: lines.join('\n') } : {};
}

export function authNotice(event: McpAuthEvent): AuthNotice {
  const title = `OAuth · ${event.server}`;
  switch (event.phase) {
    case 'required': return { title, subtitle: 'authorization required', tone: 'accent', status: 'active' };
    case 'opened': return { title, subtitle: 'browser opened', tone: 'accent', status: 'active', ...withUrl(event) };
    case 'waiting': return { title, subtitle: 'waiting for browser authorization', tone: 'accent', status: 'active', ...withUrl(event) };
    case 'completed': return { title, subtitle: 'authorization completed', tone: 'success', status: 'done' };
    case 'cancelled': return { title, subtitle: 'authorization cancelled', tone: 'warn', status: 'failed' };
    case 'failed': return { title, subtitle: 'authorization failed', detail: event.detail, tone: 'danger', status: 'failed' };
  }
}
