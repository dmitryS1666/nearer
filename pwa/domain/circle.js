/**
 * Future shape: a Couple becomes a private Circle
 * (мы, семья, дети, родители, близкие).
 * MVP keeps a single private circle and does not expose multi-user UI.
 */
export const CIRCLE_KINDS = ['couple', 'family', 'children', 'parents', 'friends'];

export function circleSummary(state) {
  return {
    id: state.circleId || null,
    kind: 'couple',
    name: 'Мы',
    privacy: 'private'
  };
}
