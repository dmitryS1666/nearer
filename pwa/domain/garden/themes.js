/** Garden v2 theme catalog. Bumping CONTENT_VERSION does not rewrite period snapshots. */
export const GARDEN_CONTENT_VERSION = 1;

export const QUESTION_SCHEDULE_DAYS = [1, 4, 8, 11, 15, 18, 21];

export const PLANT_STAGES = [
  { id: 'seed', name: 'Семя', minMutual: 0, maxMutual: 0 },
  { id: 'sprout', name: 'Росток', minMutual: 1, maxMutual: 1 },
  { id: 'stem', name: 'Стебель', minMutual: 2, maxMutual: 3 },
  { id: 'leaves', name: 'Листья', minMutual: 4, maxMutual: 5 },
  { id: 'bud', name: 'Бутон', minMutual: 6, maxMutual: 6 },
  { id: 'bloom', name: 'Цветение', minMutual: 7, maxMutual: 7 }
];

export const REQUIRED_QUESTION_COUNT = 7;

/**
 * @typedef {{ id: string, order: number, weekHint: number, kind: 'main'|'final', text: string }} ThemeQuestion
 * @typedef {{ id: string, name: string, plantType: string, description: string, palette: object, questions: ThemeQuestion[], challenge: { id: string, text: string } }} Theme
 */

/** @type {Theme[]} */
export const GARDEN_THEMES = [
  {
    id: 'zamioculcas',
    name: 'Интересные моменты',
    plantType: 'Замиокулькас',
    description: 'Маленькие тёплые наблюдения из обычных дней — то, что легко не заметить.',
    palette: { pot: '#8B7355', leaf: '#3D7A5A', accent: '#A8C686', soil: '#5C4A3A', bloom: '#E8F0D8' },
    questions: [
      { id: 'zam-1', order: 1, weekHint: 1, kind: 'main', text: 'Какой момент из нашей обычной жизни тебе особенно запомнился?' },
      { id: 'zam-2', order: 2, weekHint: 1, kind: 'main', text: 'Что в последнее время тебя приятно удивило во мне?' },
      { id: 'zam-3', order: 3, weekHint: 2, kind: 'main', text: 'Какой маленький совместный момент был особенно тёплым?' },
      { id: 'zam-4', order: 4, weekHint: 2, kind: 'main', text: 'Что тебе хотелось бы делать вместе чаще в обычные дни?' },
      { id: 'zam-5', order: 5, weekHint: 3, kind: 'main', text: 'Какой наш бытовой ритуал тебе особенно дорог?' },
      { id: 'zam-6', order: 6, weekHint: 3, kind: 'main', text: 'Какую мелочь из нашей повседневности ты хочешь сохранить?' },
      { id: 'zam-final', order: 7, weekHint: 3, kind: 'final', text: 'Если собрать этот период в одну фразу — что для тебя было в нём самым живым?' }
    ],
    challenge: { id: 'zam-ch', text: 'Повторите один тёплый совместный ритуал — без телефонов хотя бы 30 минут.' }
  },
  {
    id: 'strelitzia',
    name: 'Рост и поддержка',
    plantType: 'Стрелиция Николая',
    description: 'Опора, развитие и вера друг в друга — без давления «стать лучше».',
    palette: { pot: '#6B5B4F', leaf: '#2F6B4F', accent: '#E8A838', soil: '#4A3F35', bloom: '#F5C76A' },
    questions: [
      { id: 'str-1', order: 1, weekHint: 1, kind: 'main', text: 'В чём ты сейчас особенно хочешь расти?' },
      { id: 'str-2', order: 2, weekHint: 1, kind: 'main', text: 'Как я могу поддержать тебя лучше — так, чтобы тебе это подошло?' },
      { id: 'str-3', order: 3, weekHint: 2, kind: 'main', text: 'Когда ты в последнее время чувствовал(а) от меня настоящую поддержку?' },
      { id: 'str-4', order: 4, weekHint: 2, kind: 'main', text: 'Что мы как пара уже делаем лучше, чем раньше?' },
      { id: 'str-5', order: 5, weekHint: 3, kind: 'main', text: 'Какую общую цель нам важно укрепить спокойно, без спешки?' },
      { id: 'str-6', order: 6, weekHint: 3, kind: 'main', text: 'Что тебе помогает чувствовать, что мы в одной команде?' },
      { id: 'str-final', order: 7, weekHint: 3, kind: 'final', text: 'Какой маленький шаг поддержки ты хочешь взять с собой из этого периода?' }
    ],
    challenge: { id: 'str-ch', text: 'Сделайте одно конкретное дело поддержки друг для друга на этой неделе.' }
  },
  {
    id: 'orchid',
    name: 'Романтика и нежность',
    plantType: 'Орхидея',
    description: 'Мягкость, жесты внимания и ощущение «меня выбирают» — без шаблонов.',
    palette: { pot: '#7A6B78', leaf: '#3F6B5A', accent: '#D4789C', soil: '#4A3A42', bloom: '#F2B8D0' },
    questions: [
      { id: 'orc-1', order: 1, weekHint: 1, kind: 'main', text: 'Когда рядом со мной ты особенно ощущаешь нежность?' },
      { id: 'orc-2', order: 2, weekHint: 1, kind: 'main', text: 'Что для тебя является проявлением романтики — своим, а не «как принято»?' },
      { id: 'orc-3', order: 3, weekHint: 2, kind: 'main', text: 'Какой мой жест делает тебя счастливее?' },
      { id: 'orc-4', order: 4, weekHint: 2, kind: 'main', text: 'Что тебе хотелось бы получать от меня чаще в эмоциональном плане?' },
      { id: 'orc-5', order: 5, weekHint: 3, kind: 'main', text: 'Что помогает тебе чувствовать себя любимым(ой) в обычные дни?' },
      { id: 'orc-6', order: 6, weekHint: 3, kind: 'main', text: 'Какой совместный момент нежности тебе хочется повторить?' },
      { id: 'orc-final', order: 7, weekHint: 3, kind: 'final', text: 'Какой нежный вывод о нас ты уносишь из этого периода?' }
    ],
    challenge: { id: 'orc-ch', text: 'Устройте один вечер только для двоих — без экранов и спешки.' }
  },
  {
    id: 'lavender',
    name: 'Спокойствие и доверие',
    plantType: 'Лаванда',
    description: 'Безопасность, устойчивость и ощущение дома рядом друг с другом.',
    palette: { pot: '#6E6A78', leaf: '#5A7A5A', accent: '#8B7BB8', soil: '#4A4550', bloom: '#C4B5E0' },
    questions: [
      { id: 'lav-1', order: 1, weekHint: 1, kind: 'main', text: 'В какие моменты рядом со мной ты чувствуешь спокойствие?' },
      { id: 'lav-2', order: 2, weekHint: 1, kind: 'main', text: 'Что помогает тебе доверять мне ещё больше?' },
      { id: 'lav-3', order: 3, weekHint: 2, kind: 'main', text: 'Что в наших отношениях даёт тебе ощущение устойчивости?' },
      { id: 'lav-4', order: 4, weekHint: 2, kind: 'main', text: 'Какой формат заботы особенно помогает тебе, когда тебе тяжело?' },
      { id: 'lav-5', order: 5, weekHint: 3, kind: 'main', text: 'Что создаёт ощущение «дома» в наших отношениях?' },
      { id: 'lav-6', order: 6, weekHint: 3, kind: 'main', text: 'Как я могу сделать пространство между нами ещё спокойнее?' },
      { id: 'lav-final', order: 7, weekHint: 3, kind: 'final', text: 'Какое чувство безопасности ты хочешь сохранить после этого периода?' }
    ],
    challenge: { id: 'lav-ch', text: 'Проведите один спокойный совместный час: чай, прогулка или тишина без задач.' }
  }
];

export function getThemeById(themeId) {
  return GARDEN_THEMES.find((t) => t.id === themeId) || null;
}

export function snapshotTheme(theme, contentVersion = GARDEN_CONTENT_VERSION) {
  return {
    contentVersion,
    themeId: theme.id,
    name: theme.name,
    plantType: theme.plantType,
    description: theme.description,
    palette: { ...theme.palette },
    questions: theme.questions.map((q) => ({ ...q })),
    challenge: { ...theme.challenge }
  };
}

export function stageForMutualCount(mutualCount) {
  const n = Math.max(0, Math.min(REQUIRED_QUESTION_COUNT, Number(mutualCount) || 0));
  for (let i = PLANT_STAGES.length - 1; i >= 0; i -= 1) {
    if (n >= PLANT_STAGES[i].minMutual) return PLANT_STAGES[i];
  }
  return PLANT_STAGES[0];
}
