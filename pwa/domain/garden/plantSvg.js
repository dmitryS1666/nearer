/**
 * Shared SVG plant system — six stages × four palettes (shape + color differ by plantType).
 */
const STAGE_ORDER = ['seed', 'sprout', 'stem', 'leaves', 'bud', 'bloom'];

function pot(palette) {
  return `<ellipse cx="50" cy="88" rx="22" ry="6" fill="${palette.soil}" opacity=".55"/>
    <path d="M32 72h36l-4 16H36z" fill="${palette.pot}"/>
    <path d="M34 72h32v3H34z" fill="${palette.soil}"/>`;
}

function seed(palette) {
  return `${pot(palette)}<ellipse cx="50" cy="68" rx="6" ry="4" fill="${palette.accent}"/>`;
}

function sprout(palette) {
  return `${pot(palette)}
    <path d="M50 72v-14" stroke="${palette.leaf}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M50 60c-8-2-10-10-6-12 4 6 6 8 6 12z" fill="${palette.leaf}"/>
    <path d="M50 60c8-2 10-10 6-12-4 6-6 8-6 12z" fill="${palette.accent}" opacity=".85"/>`;
}

function stem(palette) {
  return `${pot(palette)}
    <path d="M50 72V42" stroke="${palette.leaf}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M50 58c-12-4-14-14-8-18 6 8 8 12 8 18z" fill="${palette.leaf}"/>
    <path d="M50 52c12-3 14-12 8-16-5 7-7 10-8 16z" fill="${palette.accent}" opacity=".9"/>`;
}

function leaves(palette, wide = false) {
  const span = wide ? 16 : 12;
  return `${pot(palette)}
    <path d="M50 72V34" stroke="${palette.leaf}" stroke-width="2.8" fill="none" stroke-linecap="round"/>
    <path d="M50 50c-${span}-6-${span + 2}-16-${span - 4}-20 ${span - 4} 10 ${span - 2} 14 ${span - 4} 20z" fill="${palette.leaf}"/>
    <path d="M50 44c${span}-5 ${span + 2}-14 ${span - 4}-18-${span - 4} 9-${span - 2} 12-${span - 4} 18z" fill="${palette.leaf}"/>
    <path d="M50 38c-10-8-8-16-2-18 2 8 2 12 2 18z" fill="${palette.accent}" opacity=".85"/>
    <path d="M50 38c10-8 8-16 2-18-2 8-2 12-2 18z" fill="${palette.accent}" opacity=".7"/>`;
}

function bud(palette) {
  return `${leaves(palette, true)}
    <ellipse cx="50" cy="28" rx="7" ry="10" fill="${palette.bloom}"/>
    <ellipse cx="50" cy="30" rx="4" ry="6" fill="${palette.accent}" opacity=".55"/>`;
}

function bloom(palette, flower = 'round') {
  const base = leaves(palette, true);
  if (flower === 'spike') {
    return `${base}
      <path d="M50 32c-2-14 2-22 0-28 6 8 8 18 6 28z" fill="${palette.bloom}"/>
      <path d="M44 30c-6-4-8-12-4-16 6 4 8 10 8 16z" fill="${palette.accent}"/>
      <path d="M56 30c6-4 8-12 4-16-6 4-8 10-8 16z" fill="${palette.accent}"/>`;
  }
  if (flower === 'star') {
    return `${base}
      <circle cx="50" cy="26" r="5" fill="${palette.accent}"/>
      <path d="M50 14l2.2 8.2H61l-7 5.2 2.6 8.2L50 30.8l-6.6 4.8 2.6-8.2-7-5.2h8.8z" fill="${palette.bloom}"/>`;
  }
  return `${base}
    <circle cx="50" cy="26" r="11" fill="${palette.bloom}"/>
    <circle cx="50" cy="26" r="5" fill="${palette.accent}"/>
    <circle cx="42" cy="22" r="5" fill="${palette.bloom}" opacity=".9"/>
    <circle cx="58" cy="22" r="5" fill="${palette.bloom}" opacity=".9"/>
    <circle cx="44" cy="32" r="4.5" fill="${palette.bloom}" opacity=".85"/>
    <circle cx="56" cy="32" r="4.5" fill="${palette.bloom}" opacity=".85"/>`;
}

const FLOWER_STYLE = {
  Замиокулькас: 'round',
  'Стрелиция Николая': 'spike',
  Орхидея: 'star',
  Лаванда: 'spike'
};

export function renderPlantSvg(stageId, palette, { plantType = '', className = '', bloomAnim = false } = {}) {
  const stage = STAGE_ORDER.includes(stageId) ? stageId : 'seed';
  const p = {
    pot: palette?.pot || '#8B7355',
    leaf: palette?.leaf || '#3D7A5A',
    accent: palette?.accent || '#A8C686',
    soil: palette?.soil || '#5C4A3A',
    bloom: palette?.bloom || '#E8F0D8'
  };
  let body = seed(p);
  if (stage === 'sprout') body = sprout(p);
  else if (stage === 'stem') body = stem(p);
  else if (stage === 'leaves') body = leaves(p);
  else if (stage === 'bud') body = bud(p);
  else if (stage === 'bloom') body = bloom(p, FLOWER_STYLE[plantType] || 'round');

  const animClass = bloomAnim && stage === 'bloom' ? ' plant-bloom' : '';
  return `<svg class="plant-svg ${className}${animClass}" viewBox="0 0 100 100" role="img" aria-label="${stage}" focusable="false">${body}</svg>`;
}

export function stageIndex(stageId) {
  const i = STAGE_ORDER.indexOf(stageId);
  return i < 0 ? 0 : i;
}

export { STAGE_ORDER };
