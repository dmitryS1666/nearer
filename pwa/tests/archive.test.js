import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../domain/LocalCoupleRepository.js';
import { migrateState, SCHEMA_VERSION } from '../domain/schema.js';
import { createList, updateList, deleteList, createListItem, getListItems } from '../domain/lists/model.js';
import { reserveListItem, completeListItem, visibleItemForRole } from '../domain/wishlist/model.js';
import { createMoment, updateMoment, deleteMoment, getMoment } from '../domain/moments/model.js';
import { attachMedia, mediaForMoment, buildLocalAttachmentInput, clearLocalPhotoCache, estimatePhotoBytes } from '../domain/media/model.js';
import { createImportantDate, nextOccurrence, daysUntil } from '../domain/dates/model.js';
import { collectReminders } from '../domain/events/reminders.js';
import { searchMemories } from '../domain/memories/search.js';
import { buildYearReview } from '../domain/memories/yearReview.js';
import { buildTimeline } from '../domain/memories/timeline.js';
import { isWfolioUrl, normalizeGalleryMetadata, WfolioPhotoProvider } from '../integrations/wfolio/wfolio.js';
import { classifyShare, IncomingShareHandler } from '../platform/share/incomingShare.js';
import { readCacheEntry, LINK_PREVIEW_TTL_MS } from '../platform/metadata/productMetadata.js';
import { circleSummary } from '../domain/circle.js';
import { isUuid } from '../domain/ids.js';

function ids() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

function baseState() {
  return migrateState(structuredClone(initialState), {
    now: '2026-10-16T12:00:00.000Z',
    idFactory: ids()
  });
}

describe('migration', () => {
  it('keeps old answers and seeds default lists once', () => {
    const old = {
      onboarded: true,
      profile: { name: 'Дима', partnerName: 'Катя' },
      streak: 4,
      completedDays: 4,
      answers: { '2024-03-12': { a: { text: 'Мы рядом' }, b: { text: 'Да' } } },
      history: [{ calendarDate: '2024-03-12', question: 'Как мы?', answers: { a: { text: 'Мы рядом' } } }]
    };
    const idFactory = ids();
    const migrated = migrateState(structuredClone(old), { now: '2026-10-16T12:00:00.000Z', idFactory });
    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.equal(migrated.answers['2024-03-12'].a.text, 'Мы рядом');
    assert.equal(migrated.history[0].question, 'Как мы?');
    assert.equal(migrated.streak, 4);
    assert.equal(migrated.profile.name, 'Дима');
    assert.equal(migrated.lists.length, 6);
    assert.equal(migrated.startedUsingAt.startsWith('2024-03-12'), true);
    const names = migrated.lists.map((list) => list.name);
    assert.deepEqual(names, ['Хотелки', 'Куда сходить', 'Посмотреть вместе', 'Куда поехать', 'Свидания', 'Для дома']);
    assert.ok(migrated.lists.every((list) => isUuid(list.id)));
    const again = migrateState(structuredClone(migrated), { now: '2026-10-17T12:00:00.000Z', idFactory: ids() });
    assert.equal(again.lists.length, 6);
    assert.equal(again.lists[0].id, migrated.lists[0].id);
  });
});

describe('lists', () => {
  it('creates, updates and deletes a custom list without touching wishes', () => {
    const state = baseState();
    const list = createList(state, { name: 'Книги', icon: '📚' }, { actorRole: 'a', now: '2026-10-16T12:00:00.000Z' });
    assert.equal(list.name, 'Книги');
    assert.equal(updateList(state, list.id, { name: 'Наши книги' }).name, 'Наши книги');
    assert.equal(deleteList(state, list.id), true);
    assert.equal(state.lists.some((item) => item.id === list.id), false);
    assert.equal(state.lists.length, 6);
  });
});

describe('wishlist', () => {
  it('hides a reservation from the author and turns a purchase into a moment draft', () => {
    const state = baseState();
    const wishlist = state.lists.find((list) => list.type === 'wishlist');
    const item = createListItem(state, {
      listId: wishlist.id,
      title: 'Плед',
      url: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      metadata: { price: 12990, currency: 'RUB', store: 'Wildberries' }
    }, { actorRole: 'a' });
    const hidden = reserveListItem(state, item.id, { actorRole: 'b' });
    assert.equal(hidden.ok, true);
    assert.equal(state.listItems[0].status, 'reserved');
    assert.equal(state.listItems[0].reservedBy, undefined);
    assert.equal(visibleItemForRole(state, state.listItems[0], 'a').status, 'active');
    assert.equal(visibleItemForRole(state, state.listItems[0], 'b').status, 'reserved');
    assert.equal(state.reservations[0].reservedBy, 'b');
    assert.equal(reserveListItem(state, item.id, { actorRole: 'a' }).ok, false);

    const done = completeListItem(state, item.id, { actorRole: 'b' });
    assert.equal(done.item.status, 'purchased');
    assert.equal(state.reservations.length, 0);
    assert.equal(done.momentDraft.title, 'Плед');
    assert.deepEqual(done.momentDraft.relatedListItems, [item.id]);
    assert.equal(state.domainEvents.some((event) => event.type === 'WishlistItemCompleted'), true);
  });
});

describe('moments', () => {
  it('creates, edits, deletes and keeps media on the moment', () => {
    const state = baseState();
    const moment = createMoment(state, {
      title: 'Поездка в Стамбул',
      date: '2026-06-12',
      endDate: '2026-06-18',
      type: 'trip',
      location: { name: 'Стамбул', latitude: 41.01, longitude: 28.97 }
    }, { actorRole: 'a' });
    const media = attachMedia(state, moment.id, {
      type: 'image',
      provider: 'local',
      previewUrl: 'data:image/jpeg;base64,YQ==',
      metadata: { thumbnail: 'data:image/jpeg;base64,YQ==' }
    });
    assert.equal(getMoment(state, moment.id).coverImage, media.previewUrl);
    assert.equal(mediaForMoment(state, moment.id).length, 1);
    updateMoment(state, moment.id, { title: 'Наша поездка в Стамбул', favorite: true });
    assert.equal(getMoment(state, moment.id).favorite, true);
    assert.equal(deleteMoment(state, moment.id), true);
    assert.equal(state.moments.length, 0);
    assert.equal(state.mediaAttachments.length, 0);
  });
});

describe('photos', () => {
  it('stores previews by strategy and can clear the cache without deleting moments', () => {
    assert.equal(buildLocalAttachmentInput({ variants: { previewUrl: 'data:image/jpeg;base64,YQ==' }, mode: 'links' }).error, 'links_mode');
    const preview = buildLocalAttachmentInput({
      variants: { previewUrl: 'data:image/jpeg;base64,YQ==', thumbnail: 'data:image/jpeg;base64,Yg==', originalDataUrl: 'data:image/jpeg;base64,Yw==' },
      mode: 'preview'
    });
    assert.equal(preview.metadata.originalDataUrl, undefined);
    assert.ok(preview.metadata.thumbnail);
    const state = baseState();
    const moment = createMoment(state, { title: 'Дома', date: '2026-01-02' });
    attachMedia(state, moment.id, preview);
    assert.ok(estimatePhotoBytes(state) > 0);
    clearLocalPhotoCache(state);
    assert.equal(estimatePhotoBytes(state), 0);
    assert.equal(state.moments[0].title, 'Дома');
  });
});

describe('wfolio', () => {
  it('detects gallery urls and survives a provider failure', async () => {
    assert.equal(isWfolioUrl('https://gallery.wfolio.ru/disk/abc'), true);
    assert.equal(isWfolioUrl('https://ozon.ru/product/1'), false);
    const normalized = normalizeGalleryMetadata({ title: 'Свадьба', imageUrl: 'https://cdn.example/cover.jpg' }, 'https://gallery.wfolio.ru/disk/abc');
    assert.equal(normalized.provider, 'wfolio');
    assert.equal(normalized.title, 'Свадьба');
    assert.equal(normalized.cover, 'https://cdn.example/cover.jpg');

    const failed = new WfolioPhotoProvider({
      metadataProvider: { fetch: async () => { throw new Error('offline'); } }
    });
    const gallery = await failed.importMedia({ galleryUrl: 'https://gallery.wfolio.ru/disk/abc' });
    assert.equal(gallery.provider, 'wfolio');
    assert.equal(gallery.type, 'gallery');
    assert.equal(gallery.metadata.title, 'Галерея Wfolio');
    await assert.rejects(() => failed.importMedia({ galleryUrl: 'https://example.com' }), /not_wfolio/);
  });
});

describe('share and search', () => {
  it('routes a store link to wishlist and finds a memory by place', () => {
    const state = baseState();
    const handler = new IncomingShareHandler({ getLists: () => state.lists });
    const share = handler.handle({ url: 'https://www.wildberries.ru/catalog/99/detail.aspx', title: 'Плед' });
    assert.equal(share.kind, 'product');
    assert.equal(share.listType, 'wishlist');
    assert.equal(share.listName, 'Хотелки');
    assert.equal(classifyShare({ url: 'https://gallery.wfolio.ru/a' }).suggestMoment, true);
    assert.equal(classifyShare({ text: 'Пойдём сюда https://yandex.ru/maps/org/cafe' }).listType, 'places');
    assert.equal(classifyShare({ url: 'https://www.kinopoisk.ru/film/1/' }).listType, 'watch');

    createMoment(state, { title: 'Стамбул', date: '2027-06-01', location: { name: 'Стамбул' }, tags: ['отпуск'] });
    const hits = searchMemories(state, 'Стамбул');
    assert.equal(hits[0].kind, 'moment');
    assert.equal(searchMemories(state, '2027')[0].title, 'Стамбул');
  });
});

describe('history builders', () => {
  it('builds a year review, a timeline and an anniversary reminder', () => {
    const state = baseState();
    state.startedUsingAt = '2026-01-10T00:00:00.000Z';
    const trips = state.lists.find((list) => list.type === 'trips');
    const item = createListItem(state, { listId: trips.id, title: 'Грузия' }, { actorRole: 'a', now: '2026-06-02T00:00:00.000Z' });
    completeListItem(state, item.id, { actorRole: 'a', now: '2026-06-20T00:00:00.000Z' });
    createMoment(state, { title: 'Поездка в Грузию', date: '2026-06-17', type: 'trip', favorite: true });
    const review = buildYearReview(state, 2026, new Date(2026, 9, 16));
    assert.equal(review.trips >= 1, true);
    assert.equal(review.title, 'Наш 2026 год');
    const timeline = buildTimeline(state);
    assert.ok(timeline.some((year) => year.items.some((entry) => entry.title === 'Поездка в Грузию')));
    assert.ok(timeline.some((year) => year.items.some((entry) => entry.kind === 'start')));

    createImportantDate(state, { title: 'Годовщина', date: '2020-10-20', repeatYearly: true, reminder: { enabled: true, daysBefore: 7 } });
    const reminders = collectReminders(state, new Date(2026, 9, 16));
    assert.ok(reminders.some((entry) => entry.type === 'ImportantDateApproaching'));
    assert.equal(nextOccurrence('2020-02-29', true, new Date(2026, 2, 1)), '2027-02-28');
    assert.equal(daysUntil('2026-10-20', new Date(2026, 9, 16)), 4);
  });
});

describe('link preview cache and privacy', () => {
  it('expires cached metadata and keeps the circle private', () => {
    const fresh = readCacheEntry({ storedAt: 1_000, value: { title: 'Плед' } }, 1_000 + 1000);
    assert.equal(fresh.title, 'Плед');
    const stale = readCacheEntry({ storedAt: 1_000, value: { title: 'Плед' } }, 1_000 + LINK_PREVIEW_TTL_MS + 1);
    assert.equal(stale, null);
    const state = baseState();
    assert.equal(circleSummary(state).privacy, 'private');
    assert.equal(circleSummary(state).kind, 'couple');
  });
});

describe('repository api', () => {
  it('delegates list creation through LocalCoupleRepository', async () => {
    const { LocalCoupleRepository } = await import('../domain/LocalCoupleRepository.js');
    const repo = new LocalCoupleRepository();
    const state = baseState();
    const before = getListItems(state).length;
    const list = repo.createList(state, { name: 'Идеи' }, { actorRole: 'b' });
    const item = repo.createListItem(state, { listId: list.id, title: 'Пикник' }, { actorRole: 'b' });
    assert.equal(repo.getLists(state).some((entry) => entry.id === list.id), true);
    assert.equal(repo.getListItems(state, list.id)[0].id, item.id);
    assert.equal(getListItems(state).length, before + 1);
    const moment = repo.createMoment(state, { title: 'Пикник состоялся', date: '2026-08-01' }, { actorRole: 'b' });
    repo.attachMedia(state, moment.id, { type: 'gallery', provider: 'wfolio', sourceUrl: 'https://gallery.wfolio.ru/x' });
    assert.equal(repo.getMoment(state, moment.id).media.length, 1);
    const date = repo.createImportantDate(state, { title: 'День знакомства', date: '2019-05-08' });
    assert.equal(repo.getImportantDates(state).some((entry) => entry.id === date.id), true);
  });
});
