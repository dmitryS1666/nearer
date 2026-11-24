export function shouldShowReleaseNotes(state, versionName) {
  if (!state?.onboarded || !versionName) return false;
  return state.releaseSeen !== versionName;
}

export function releaseNotes(versionName) {
  return {
    versionName,
    eyebrow: `Ближе ${versionName}`,
    title: 'Можно писать спокойнее',
    lede: 'Если вы уже были здесь, пара, ответы и сад остались на месте.',
    points: [
      'Клавиатура больше не прячется посреди ответа. Черновик остаётся на телефоне.',
      'Ваши слова подписаны вашим именем. Слова партнёра — его.',
      'В настройках можно оставить отзыв и посмотреть обновление.'
    ]
  };
}
