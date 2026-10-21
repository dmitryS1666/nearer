/**
 * Lightweight browser-less smoke of core domain flow.
 * Full UI smoke: npm run test:e2e (Playwright) when available.
 */
import assert from 'node:assert/strict';
import {
  LocalCoupleRepository,
  initialState,
  gardenFromCompletedDays
} from '../pwa/domain/LocalCoupleRepository.js';
import { QUESTIONS } from '../pwa/domain/questionsData.js';

const repo = new LocalCoupleRepository();
repo.questions = QUESTIONS;
const state = structuredClone(initialState);
state.onboarded = true;
state.profile = { name: 'Дима', partnerName: 'Катя' };
repo.ensureTodayQuestion(state);

const key = repo.todayKey(state);
state.answers[key] = {
  a: { text: 'Мне нравится, как мы поддерживаем друг друга.', submittedAt: new Date().toISOString() }
};
assert.ok(state.answers[key].a.text);
assert.ok(!state.answers[key].b);

// waiting → partner
state.answers[key].b = { text: 'Я тоже это чувствую.', submittedAt: new Date().toISOString() };
assert.ok(state.answers[key].a.text && state.answers[key].b.text);

// reveal → complete
state.reactions[key] = '❤️';
state.history.push({
  calendarDate: key,
  date: 'сегодня',
  question: repo.getTodayQuestion(state).text,
  category: 'support',
  answers: structuredClone(state.answers[key]),
  reaction: '❤️'
});
state.completedDays += 1;
state.streak += 1;

const garden = gardenFromCompletedDays(state.completedDays);
assert.ok(garden.stage);
assert.equal(state.history.length, 1);
assert.equal(state.streak, 1);

const { migrateState } = await import('../pwa/domain/schema.js');
const { createListItem } = await import('../pwa/domain/lists/model.js');
const { completeListItem } = await import('../pwa/domain/wishlist/model.js');
const { createMoment } = await import('../pwa/domain/moments/model.js');
const { attachMedia } = await import('../pwa/domain/media/model.js');
const { isWfolioUrl, normalizeGalleryMetadata } = await import('../pwa/integrations/wfolio/wfolio.js');
const { classifyShare } = await import('../pwa/platform/share/incomingShare.js');

const archive = migrateState(state);
assert.equal(archive.lists.length, 6);
assert.equal(archive.history.length, 1);
const wishes = archive.lists.find((list) => list.type === 'wishlist');
const trips = archive.lists.find((list) => list.type === 'trips');
const wish = createListItem(archive, {
  listId: wishes.id,
  title: 'Плед',
  url: 'https://www.wildberries.ru/catalog/123/detail.aspx'
}, { actorRole: 'a' });
assert.equal(classifyShare({ url: wish.url }).listType, 'wishlist');
const trip = createListItem(archive, { listId: trips.id, title: 'Стамбул' }, { actorRole: 'a' });
const completed = completeListItem(archive, trip.id, { actorRole: 'a' });
assert.equal(completed.momentDraft.title, 'Стамбул');
const moment = createMoment(archive, completed.momentDraft, { actorRole: 'a' });
assert.equal(isWfolioUrl('https://gallery.wfolio.ru/disk/1'), true);
const gallery = normalizeGalleryMetadata({ title: 'Стамбул', imageUrl: 'https://cdn.example/cover.jpg' }, 'https://gallery.wfolio.ru/disk/1');
attachMedia(archive, moment.id, { type: 'gallery', provider: 'wfolio', sourceUrl: gallery.galleryUrl, previewUrl: gallery.cover, metadata: gallery });
assert.equal(moment.relatedListItems[0], trip.id);
assert.equal(archive.mediaAttachments.length, 1);

console.log('smoke_web=PASS');
console.log('question=', repo.getTodayQuestion(state).id);
console.log('garden=', garden.stage.id);
console.log('lists=', archive.lists.length);
