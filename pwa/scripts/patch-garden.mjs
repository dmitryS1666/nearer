import fs from 'node:fs';

const path = 'app.js';
let src = fs.readFileSync(path, 'utf8');
const start = src.indexOf('function gardenView()');
const end = src.indexOf('function historyView()');
if (start < 0 || end < 0) throw new Error(`markers not found ${start} ${end}`);

const replacement = `function remainingDaysPhrase(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return \`Ещё \${n} совместный день до следующего этапа.\`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return \`Ещё \${n} совместных дня до следующего этапа.\`;
  return \`Ещё \${n} совместных дней до следующего этапа.\`;
}

function triggerGardenAnim(prevCompletedDays, nextCompletedDays) {
  const prev = gardenFromCompletedDays(prevCompletedDays);
  const next = gardenFromCompletedDays(nextCompletedDays);
  gardenAnim = {
    type: prev.stage.id !== next.stage.id ? 'stage-up' : 'grow',
    stageId: next.stage.id
  };
  setTimeout(() => {
    if (gardenAnim?.stageId === next.stage.id) gardenAnim = null;
  }, 1200);
}

function gardenView() {
  const garden = gardenFromCompletedDays(state.completedDays);
  const stage = garden.stage;
  const animClass =
    gardenAnim?.stageId === stage.id
      ? gardenAnim.type === 'stage-up'
        ? 'garden-stage-up'
        : 'garden-grow'
      : '';
  const remaining = garden.next ? Math.max(0, garden.next.minDays - state.completedDays) : 0;
  return shell(
    \`
    <section class="page-head"><div><div class="eyebrow">Ваше общее пространство</div><h1>Сад отношений</h1><p>Он растёт не от идеальных ответов, а от регулярного внимания друг к другу.</p></div><div class="streak-bubble"><span>🔥</span><b>\${state.streak}</b><small>streak</small></div></section>
    <section class="garden-card glass-card">
      <div class="sky-stars">✦ · ✧ · ✦</div>
      <div class="garden-stage \${animClass}" aria-label="\${escapeHtml(stage.name)}">\${stage.icon}</div>
      <h2>\${escapeHtml(stage.name)}</h2>
      <p>\${!garden.next ? 'Ваш сад уже стал настоящим маленьким миром.' : remainingDaysPhrase(remaining)}</p>
      <div class="progress-track"><div class="progress-bar" style="width:\${garden.progress}%"></div></div>
      <div class="milestones"><span>Завершённых дней: <b>\${state.completedDays}</b></span><span>Этап: <b>\${escapeHtml(stage.name)}</b></span></div>
    </section>
    <section class="stats-grid">
      <div class="stat-card"><span>💌</span><b>\${state.history.length}</b><small>вопросов в истории</small></div>
      <div class="stat-card"><span>🔥</span><b>\${state.streak}</b><small>текущий streak</small></div>
      <div class="stat-card"><span>♥</span><b>\${Object.keys(state.reactions).length}</b><small>реакций</small></div>
    </section>
  \`,
    'garden'
  );
}

`;

src = src.slice(0, start) + replacement + src.slice(end);
fs.writeFileSync(path, src);
console.log('patched gardenView ok');
