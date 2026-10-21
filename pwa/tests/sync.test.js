import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPairStore } from '../../server/pairStore.js';
import { createPairService } from '../../server/pairs.js';
import { initialState } from '../domain/LocalCoupleRepository.js';
import { migrateState } from '../domain/schema.js';
import { buildSyncPayload } from '../domain/sync/payload.js';
import { mergeSyncPayload } from '../domain/sync/merge.js';
import { generatePairIdentity, deriveSyncKey, encryptJson, decryptJson } from '../platform/link/pairCrypto.js';

describe('sync merge', () => {
  it('merges answers and list items without dropping either side', () => {
    const local = migrateState({
      ...structuredClone(initialState),
      answers: {
        '2026-10-21': { a: { text: 'local-a', submittedAt: '2026-10-21T10:00:00.000Z' } }
      },
      listItems: [{ id: 'i1', title: 'old', updatedAt: '2026-10-20T00:00:00.000Z', version: 1 }],
      currentRole: 'a',
      profile: { name: 'Аня', partnerName: 'Партнёр' }
    });
    const remote = buildSyncPayload(
      migrateState({
        ...structuredClone(initialState),
        answers: {
          '2026-10-21': { b: { text: 'remote-b', submittedAt: '2026-10-21T11:00:00.000Z' } }
        },
        listItems: [
          { id: 'i1', title: 'new', updatedAt: '2026-10-21T00:00:00.000Z', version: 2 },
          { id: 'i2', title: 'peer', updatedAt: '2026-10-21T00:00:00.000Z', version: 1 }
        ],
        profile: { name: 'Боря', partnerName: 'Аня' }
      })
    );
    const merged = mergeSyncPayload(local, remote);
    assert.equal(merged.answers['2026-10-21'].a.text, 'local-a');
    assert.equal(merged.answers['2026-10-21'].b.text, 'remote-b');
    assert.equal(merged.listItems.find((item) => item.id === 'i1').title, 'new');
    assert.equal(merged.listItems.find((item) => item.id === 'i2').title, 'peer');
    assert.equal(merged.profile.name, 'Аня');
    assert.equal(merged.profile.partnerName, 'Боря');
  });

  it('scrubs inline photo data from sync payloads', () => {
    const payload = buildSyncPayload({
      ...structuredClone(initialState),
      moments: [{ id: 'm1', coverImage: 'data:image/png;base64,aaaa', media: [] }],
      mediaAttachments: [{ id: 'p1', sourceUrl: 'data:image/jpeg;base64,bbbb', previewUrl: 'https://cdn.example/x.jpg' }]
    });
    assert.equal(payload.moments[0].coverImage, '');
    assert.equal(payload.mediaAttachments[0].sourceUrl, '');
    assert.equal(payload.mediaAttachments[0].previewUrl, 'https://cdn.example/x.jpg');
    assert.equal(JSON.stringify(payload).includes('data:image'), false);
  });
});

describe('encrypted pair sync over the store', () => {
  it('lets device B read device A ciphertext and never stores plaintext', async () => {
    const alice = await generatePairIdentity();
    const bob = await generatePairIdentity();
    const store = createPairStore({ now: () => 100 });
    const api = createPairService(store, { now: () => 100 });
    const created = api.handle({
      method: 'POST',
      path: '/api/pairs',
      rawBody: JSON.stringify({ publicKey: alice.publicKey })
    });
    const joined = api.handle({
      method: 'POST',
      path: '/api/pairs/join',
      rawBody: JSON.stringify({ code: created.json.code, publicKey: bob.publicKey })
    });
    assert.equal(joined.status, 200);

    const keyA = await deriveSyncKey(alice.privateKeyJwk, bob.publicKey);
    const keyB = await deriveSyncKey(bob.privateKeyJwk, alice.publicKey);
    const sealed = await encryptJson(keyA, buildSyncPayload({
      ...structuredClone(initialState),
      answers: { '2026-10-21': { a: { text: 'только для двоих', submittedAt: '2026-10-21T12:00:00.000Z' } } }
    }));

    const put = api.handle({
      method: 'PUT',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`,
      rawBody: JSON.stringify({ ...sealed, baseRevision: 0 })
    });
    assert.equal(put.status, 200);

    const disk = JSON.stringify(store.getSync(joined.json.deviceToken));
    assert.equal(disk.includes('только для двоих'), false);

    const pulled = api.handle({
      method: 'GET',
      path: '/api/pairs/sync',
      authorization: `Bearer ${joined.json.deviceToken}`
    });
    const opened = await decryptJson(keyB, pulled.json);
    assert.equal(opened.answers['2026-10-21'].a.text, 'только для двоих');
  });
});
