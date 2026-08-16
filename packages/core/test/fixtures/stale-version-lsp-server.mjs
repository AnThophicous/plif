import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
} from 'vscode-jsonrpc/node';

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);

let openedVersion = 0;

connection.onRequest('initialize', () => ({
  capabilities: { textDocumentSync: 1 },
}));

connection.onNotification('textDocument/didOpen', (params) => {
  const { uri, version } = params.textDocument;
  openedVersion = version;
  connection.sendNotification('textDocument/publishDiagnostics', {
    uri,
    version,
    diagnostics: [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: 1,
      source: 'stale-version-fake',
      code: 'old-content',
      message: 'diagnostic from the old document content',
    }],
  });
});

connection.onNotification('textDocument/didChange', (params) => {
  const { uri, version } = params.textDocument;
  connection.sendNotification('textDocument/publishDiagnostics', {
    uri,
    version: openedVersion,
    diagnostics: [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: 1,
      source: 'stale-version-fake',
      code: 'stale-change',
      message: `stale diagnostic for version ${openedVersion}; current version is ${version}`,
    }],
  });
});

connection.onRequest('shutdown', () => null);
connection.onNotification('exit', () => process.exit(0));
connection.listen();
