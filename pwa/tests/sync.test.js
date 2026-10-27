import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPairStore } from '../../server/pairStore.js';
import { createPairService } from '../../server/pairs.js';
import { initialState } from '../domain/LocalCoupleRepository.js';
import { migrateState } from '../domain/schema.js';
import { buildSyncPayload } from '../domain/sync/payload.js';
import { mergeSyncPayload } from '../domain/sync/merge.js';
import { getDayAnswers } from '../domain/garden/ownership.js';
import { generatePairIdentity, deriveSyncKey, encryptJson, decryptJson } from '../platform/link/pairCrypto.js';

describe('sync merge', () => {
  it('merges answers and list items without dropping either side', () => {
    const local = migrateState({
      ...structuredClone(initialState),
      circleId: 'shared',
      activeCircleId: 'shared',
      answers: {
        '2026-10-21': {
          circleId: 'shared',
          a: { text: 'local-a', submittedAt: '2026-10-21T10:00:00.000Z' }
        }
      },
      listItems: [
        { id: 'i1', circleId: 'shared', title: 'old', updatedAt: '2026-10-20T00:00:00.000Z', version: 1 }
      ],
      currentRole: 'a',
      profile: { name: 'Аня', partnerName: 'Партнёр' }
    });
    const remote = buildSyncPayload(
      migrateState({
        ...structuredClone(initialState),
        circleId: 'shared',
        activeCircleId: 'shared',
        answers: {
          '2026-10-21': {
            circleId: 'shared',
            b: { text: 'remote-b', submittedAt: '2026-10-21T11:00:00.000Z' }
          }
        },
        listItems: [
          { id: 'i1', circleId: 'shared', title: 'new', updatedAt: '2026-10-21T00:00:00.000Z', version: 2 },
          { id: 'i2', circleId: 'shared', title: 'peer', updatedAt: '2026-10-21T00:00:00.000Z', version: 1 }
        ],
        profile: { name: 'Боря', partnerName: 'Аня' }
      })
    );
    const merged = mergeSyncPayload(local, remote);
    assert.equal(getDayAnswers(merged, '2026-10-21').a.text, 'local-a');
    assert.equal(getDayAnswers(merged, '2026-10-21').b.text, 'remote-b');
    assert.equal(merged.listItems.find((item) => item.id === 'i1').title, 'new');
    assert.equal(merged.listItems.find((item) => item.id === 'i2').title, 'peer');
    assert.equal(merged.profile.name, 'Аня');
    assert.equal(merged.profile.partnerName, 'Боря');
  });

  it('scrubs inline photo data from sync payloads', () => {
    const state = migrateState({
      ...structuredClone(initialState),
      circleId: 'c1',
      activeCircleId: 'c1',
      moments: [{ id: 'm1', circleId: 'c1', coverImage: 'data:image/png;base64,aaaa', media: [] }],
      mediaAttachments: [
        {
          id: 'p1',
          circleId: 'c1',
          sourceUrl: 'data:image/jpeg;base64,bbbb',
          previewUrl: 'https://cdn.example/x.jpg'
        }
      ]
    });
    const payload = buildSyncPayload(state);
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
    const state = migrateState({
      ...structuredClone(initialState),
      circleId: created.json.pairId,
      activeCircleId: created.json.pairId,
      answers: {
        '2026-10-21': {
          circleId: created.json.pairId,
          a: { text: 'только для двоих', submittedAt: '2026-10-21T12:00:00.000Z' }
        }
      }
    });
    const sealed = await encryptJson(keyA, buildSyncPayload(state));

    const put = api.handle({
      method: 'PUT',
      path: '/api/pairs/sync',
      authorization: `Bearer ${created.json.deviceToken}`,
      rawBody: JSON.stringify({ ...sealed, baseRevision: 0, formatVersion: 3 })
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
