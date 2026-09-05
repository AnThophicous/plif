import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/node';

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);

let configurationCount = 0;
let workspaceFolderCount = 0;
let configurationReady = Promise.resolve();

connection.onRequest('initialize', () => ({
  capabilities: {
    textDocumentSync: 1,
    diagnosticProvider: false,
  },
}));

connection.onNotification('initialized', () => {
  configurationReady = Promise.all([
    connection.sendRequest('workspace/configuration', {
      items: [
        { section: 'formattingOptions', scopeUri: 'file:///one.ts' },
        { section: 'typescript', scopeUri: 'file:///two.ts' },
      ],
    }).then((result) => {
      configurationCount = Array.isArray(result) ? result.length : -1;
    }),
    connection.sendRequest('workspace/workspaceFolders').then((result) => {
      workspaceFolderCount = Array.isArray(result) ? result.length : -1;
    }),
  ]).then(() => undefined);
});

connection.onNotification('textDocument/didOpen', (params) => {
  const uri = params.textDocument.uri;
  connection.sendNotification('textDocument/publishDiagnostics', { uri, diagnostics: [] });
  void configurationReady.then(() => {
    setTimeout(() => {
      connection.sendNotification('textDocument/publishDiagnostics', {
        uri,
        diagnostics: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 1,
          source: 'fake-lsp',
          code: 'delayed',
          message: `delayed diagnostic; configuration entries: ${configurationCount}; workspace folders: ${workspaceFolderCount}`,
        }],
      });
    // Deliberately later than the client's ordinary quiet window. An initial
    // empty publication must not be mistaken for a completed semantic pass.
    }, 450);
  });
});

connection.onNotification('textDocument/didChange', (params) => {
  connection.sendNotification('textDocument/publishDiagnostics', {
    uri: params.textDocument.uri,
    diagnostics: [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: 1,
      source: 'fake-lsp',
      code: 'duplicate-change',
      message: 'unchanged text was sent as didChange',
    }],
  });
});

// Windows rejects a driveless file URL, so build the fixture URIs the way the
// platform would actually emit them.
const fakeUri = (name) => pathToFileURL(path.join(path.sep + 'project', name)).toString();

connection.onRequest('workspace/symbol', ({ query }) => {
  if (!String(query ?? '').toLowerCase().startsWith('widget')) return [];
  return [
    {
      name: 'Widget',
      kind: 5,
      containerName: 'shell',
      location: {
        uri: fakeUri('widget.ts'),
        range: { start: { line: 11, character: 0 }, end: { line: 11, character: 6 } },
      },
    },
    // A WorkspaceSymbol may carry only a uri until workspaceSymbol/resolve runs.
    { name: 'WidgetProps', kind: 11, location: { uri: fakeUri('props.ts') } },
    // No location at all: there is nothing to report, so it must be dropped
    // rather than invented at line 1 of an unknown file.
    { name: 'WidgetGhost', kind: 12 },
  ];
});

connection.onRequest('shutdown', () => null);
connection.onNotification('exit', () => process.exit(0));
connection.listen();
