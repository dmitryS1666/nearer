import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalCoupleRepository,
  gardenFromCompletedDays,
  streakMilestone,
  calendarDateString,
  addCalendarDays,
  initialState
} from '../domain/LocalCoupleRepository.js';
import { QUESTIONS } from '../domain/questionsData.js';


describe('questions', () => {
  it('has at least 60 questions', () => {
    assert.ok(QUESTIONS.length >= 60);
  });
  it('entries have id/text/category/depth', () => {
    for (const q of QUESTIONS.slice(0, 10)) {
      assert.ok(q.id && q.text && q.category);
      assert.equal(typeof q.depth, 'number');
    }
  });
});

describe('daily question persistence', () => {
  it('keeps same question on same calendar day', () => {
    const repo = new LocalCoupleRepository();
    repo.questions = QUESTIONS;
    const state = structuredClone(initialState);
    repo.ensureTodayQuestion(state);
    const firstId = state.questionId;
    const firstDate = state.calendarDate;
    repo.ensureTodayQuestion(state);
    assert.equal(state.questionId, firstId);
    assert.equal(state.calendarDate, firstDate);
    assert.equal(firstDate, calendarDateString());
  });

  it('advances on force next test day', () => {
    const repo = new LocalCoupleRepository();
    repo.questions = QUESTIONS;
    const state = structuredClone(initialState);
    repo.ensureTodayQuestion(state);
    const prev = state.calendarDate;
    const prevId = state.questionId;
    repo.ensureTodayQuestion(state, { forceNextDay: true });
    assert.equal(state.calendarDate, addCalendarDays(prev, 1));
    assert.notEqual(state.questionId, prevId);
  });
});

describe('streak & garden', () => {
  it('increments streak milestones', () => {
    assert.equal(streakMilestone(3), 3);
    assert.equal(streakMilestone(7), 7);
    assert.equal(streakMilestone(4), null);
  });

  it('garden progression by completed days', () => {
    assert.equal(gardenFromCompletedDays(0).stage.id, 'seed');
    assert.equal(gardenFromCompletedDays(2).stage.id, 'sprout');
    assert.equal(gardenFromCompletedDays(5).stage.id, 'young');
    assert.equal(gardenFromCompletedDays(9).stage.id, 'flowering');
    assert.equal(gardenFromCompletedDays(14).stage.id, 'small-garden');
    assert.equal(gardenFromCompletedDays(21).stage.id, 'mature');
  });
});

describe('history serialization', () => {
  it('round-trips history entry shape', () => {
    const entry = {
      calendarDate: '2026-10-03',
      date: '3 октября',
      question: 'Test?',
      category: 'Будни',
      answers: { a: { text: 'A' }, b: { text: 'B' } },
      reaction: '❤️'
    };
    const json = JSON.stringify(entry);
    const parsed = JSON.parse(json);
    assert.equal(parsed.answers.a.text, 'A');
    assert.equal(parsed.reaction, '❤️');
  });
});

describe('demo partner state', () => {
  it('partner role flips', () => {
    assert.equal(initialState.currentRole, 'a');
    const partner = initialState.currentRole === 'a' ? 'b' : 'a';
    assert.equal(partner, 'b');
  });
});
