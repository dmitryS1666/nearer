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

console.log('smoke_web=PASS');
console.log('question=', repo.getTodayQuestion(state).id);
console.log('garden=', garden.stage.id);
