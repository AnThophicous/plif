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

connection.onRequest('shutdown', () => null);
connection.onNotification('exit', () => process.exit(0));
connection.listen();
