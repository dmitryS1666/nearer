const DAY = 24 * 60 * 60 * 1000;

/**
 * Active pair: both seats produced at least one consented event in the window.
 * A created pairId alone is not enough. Counts are estimates: one person can
 * reinstall, and PWA plus APK are separate installs. There are no accounts.
 */
export function buildDashboard({ events = [], feedback = [], pairSummary = null, now = Date.now() } = {}) {
  const at = typeof now === 'number' ? now : Date.parse(now);
  const inWindow = (event, days) => at - Date.parse(event.ts) <= days * DAY;
  const installs = new Set(events.map((event) => event.installId).filter(Boolean));
  const opened = (days) => new Set(
    events.filter((event) => event.event === 'app_opened' && inWindow(event, days)).map((event) => event.installId)
  );

  function pairSet(predicate) {
    const grouped = new Map();
    for (const event of events) {
      if (!event.pairHash) continue;
      if (!grouped.has(event.pairHash)) grouped.set(event.pairHash, []);
      grouped.get(event.pairHash).push(event);
    }
    let count = 0;
    for (const list of grouped.values()) {
      if (predicate(list)) count += 1;
    }
    return count;
  }

  const bothRoles = (list, extra) => {
    const roles = new Set(list.filter(extra || (() => true)).map((event) => event.role).filter((role) => role === 'a' || role === 'b'));
    return roles.has('a') && roles.has('b');
  };

  const versions = {};
  for (const event of events) {
    if (event.event !== 'app_opened') continue;
    const key = `${event.platform || 'unknown'} ${event.versionName || '?'}`;
    versions[key] = (versions[key] || 0) + 1;
  }

  return {
    definitions: {
      installs: 'Уникальные установки по анонимному install id. Переустановка и PWA+APK считаются отдельно. Это не число людей.',
      activePair: 'Пара активна, только если оба места (A и B) прислали событие в окне. Одного pair id недостаточно.',
      consent: 'Продуктовые события есть только у тех, кто включил аналитику. Числа пар из связи устройств не содержат текстов.'
    },
    installs: installs.size,
    activeInstalls: { d1: opened(1).size, d7: opened(7).size, d30: opened(30).size },
    technicalPairs: pairSummary,
    createdPairs: pairSet((list) => list.some((event) => event.event === 'pair_created')),
    connectedPairs: pairSet((list) => list.some((event) => event.event === 'pair_created') && list.some((event) => event.event === 'pair_joined')),
    bothStarted: pairSet((list) => bothRoles(list, (event) => ['app_opened', 'onboarding_completed', 'question_answered'].includes(event.event))),
    bothFinishedFirst: pairSet((list) => list.some((event) => event.event === 'mutual_answer_completed')),
    activePairs: {
      d7: pairSet((list) => bothRoles(list, (event) => inWindow(event, 7))),
      d30: pairSet((list) => bothRoles(list, (event) => inWindow(event, 30)))
    },
    mutualRituals: events.filter((event) => event.event === 'mutual_answer_completed').length,
    gardenStarted: events.filter((event) => event.event === 'garden_period_started').length,
    gardenCompleted: events.filter((event) => event.event === 'garden_period_completed').length,
    plusViewed: events.filter((event) => event.event === 'plus_viewed').length,
    plusIntent: events.filter((event) => event.event === 'plus_intent_clicked').length,
    feedback: feedback.length,
    versions
  };
}
