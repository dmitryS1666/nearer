import { QUESTIONS } from './questionsData.js';

const CATEGORY_LABELS = {
  gratitude: 'Благодарность',
  memories: 'Воспоминания',
  future: 'Будущее',
  everyday: 'Будни',
  'intimacy-safe': 'Близость',
  dreams: 'Мечты',
  fun: 'Юмор',
  support: 'Поддержка',
  relationship: 'Отношения'
};

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category || 'Вопрос';
}

export async function loadQuestions() {
  return QUESTIONS;
}

export function decorateQuestion(q) {
  if (!q) return { id: 'q000', text: '…', category: 'everyday', categoryLabel: 'Вопрос', depth: 1 };
  return { ...q, categoryLabel: categoryLabel(q.category) };
}
