import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { containerMount, containerWorkdir, WORKSPACE_SECRET_MASKS } from '../src/container-paths.js';

describe('container paths', () => {
  it('mounts only the selected workspace at a stable virtual path', () => {
    const workspace = path.resolve('workspace');
    assert.equal(containerWorkdir(workspace), '/project');
    assert.deepEqual(containerMount(workspace), {
      source: workspace,
      target: '/project',
      mode: 'rw',
      mask: WORKSPACE_SECRET_MASKS,
    });
    assert.ok(containerMount(workspace).mask.includes('/**/*.pem'));
    assert.ok(containerMount(workspace).mask.includes('/.env.*'));
  });
});
