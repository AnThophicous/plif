import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EventBus } from '../src/events/bus.js';
import { ApprovalBroker } from '../src/policy/approval.js';
import { isAutoApproveEnabled, permissionMode } from '../src/config/global.js';

describe('full permission mode', () => {
  it('persists as auto approval and answers broker requests without a prompt', async () => {
    assert.equal(permissionMode({ permissionMode: 'full' }), 'full');
    assert.equal(isAutoApproveEnabled({ permissionMode: 'full' }), true);

    const broker = new ApprovalBroker(new EventBus());
    broker.setPermissionMode('full');
    const answer = await broker.ask({
      containerId: 'test', action: 'fs.write', target: '/project/file.txt', reason: 'test', rationale: 'test',
    });
    assert.equal(answer.decision, 'allow');
  });
});
