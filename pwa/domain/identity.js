/**
 * Local identity vs answer slots.
 * profile.name is the person holding this phone.
 * profile.partnerName is the other person.
 * Answers stay in slots a/b. Display maps the local role onto "my" column.
 * A/B are pair seats, not genders. This module never moves answer text.
 */

export function deviceRole(state) {
  const linkRole = state?.deviceLink?.role;
  if (linkRole === 'a' || linkRole === 'b') return linkRole;
  return null;
}

export function localRole(state) {
  return deviceRole(state) || (state?.currentRole === 'b' ? 'b' : 'a');
}

export function partnerRole(role) {
  return role === 'b' ? 'a' : 'b';
}

export function myDisplayName(state) {
  const name = String(state?.profile?.name || '').trim();
  return name || 'Ты';
}

export function partnerDisplayName(state) {
  const name = String(state?.profile?.partnerName || '').trim();
  return name || 'Партнёр';
}

export function participantNames(state) {
  const role = localRole(state);
  const other = partnerRole(role);
  const mine = myDisplayName(state);
  const partner = partnerDisplayName(state);
  return {
    role,
    partnerRole: other,
    mine,
    partner,
    byRole: { [role]: mine, [other]: partner }
  };
}

export function textForRole(slot, role) {
  const value = slot?.[role];
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return typeof value.text === 'string' ? value.text : '';
}

/** Columns for reveal / history / garden. Does not reorder stored answers. */
export function answerColumns(state, slot) {
  const who = participantNames(state);
  return {
    mineName: who.mine,
    partnerName: who.partner,
    mineText: textForRole(slot, who.role),
    partnerText: textForRole(slot, who.partnerRole),
    role: who.role,
    partnerRole: who.partnerRole
  };
}

/**
 * Linked phones take their seat from deviceLink.
 * Returns whether currentRole changed. Never copies answers between a and b.
 */
export function reconcileDeviceRole(state) {
  const role = deviceRole(state);
  if (!role) return { changed: false, movedAnswers: false, role: state?.currentRole || null };
  const changed = state.currentRole !== role;
  state.currentRole = role;
  return { changed, movedAnswers: false, role };
}

/** Display labels only. Answer slots stay with the people who wrote them. */
export function swapDisplayNames(state) {
  const profile = state.profile || (state.profile = { name: 'Ты', partnerName: 'Партнёр' });
  const mine = profile.name;
  profile.name = profile.partnerName;
  profile.partnerName = mine;
  profile.namesLocked = true;
  return { movedAnswers: false };
}
