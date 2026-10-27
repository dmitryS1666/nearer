import { createId } from '../ids.js';
import { newEntity } from '../syncMeta.js';
import { currentCircleId } from '../garden/ownership.js';

export const DomainEventType = {
  MomentCreated: 'MomentCreated',
  WishlistItemCompleted: 'WishlistItemCompleted',
  ListItemCompleted: 'ListItemCompleted',
  ImportantDateApproaching: 'ImportantDateApproaching',
  MomentAnniversary: 'MomentAnniversary'
};

const MAX_EVENTS = 1000;

export function recordEvent(state, type, payload, now = new Date().toISOString()) {
  if (!Array.isArray(state.domainEvents)) state.domainEvents = [];
  const event = newEntity(
    {
      id: createId(),
      circleId: currentCircleId(state) || state.circleId || null,
      type,
      payload: payload || {}
    },
    now
  );
  state.domainEvents.push(event);
  if (state.domainEvents.length > MAX_EVENTS) {
    state.domainEvents.splice(0, state.domainEvents.length - MAX_EVENTS);
  }
  return event;
}
