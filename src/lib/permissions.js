// Role gating for the WFUMC Worship Planning app.
//
// App access (anyone in the allowed set can sign in):
//   pastor, office_admin, music_director, worship_team
//
// Within the app, voting eligibility is the same set. The pastor has
// special powers (final selection, opening/closing votes, off-lectionary
// entry, week grouping, the intelligence panel) — see canDecide() below.

export const ROLE_LABELS = {
  pastor: 'Pastor',
  office_admin: 'Office Admin',
  music_director: 'Music Director',
  treasurer: 'Treasurer',
  social_media: 'Social Media Team',
  worship_team: 'Worship Team',
  pianist: 'Pianist',
  staff: 'Staff',
};

const APP_ALLOWED = new Set([
  'pastor',
  'office_admin',
  'music_director',
  'worship_team',
]);

const VOTERS = APP_ALLOWED; // same set for now

export function canUseWorshipApp(role) {
  if (!role) return false;
  return APP_ALLOWED.has(role);
}

export function canVote(role) {
  return VOTERS.has(role);
}

// Pastor (and office_admin acting on the pastor's behalf) makes final
// decisions: pick a text directly, open/close votes, write in
// off-lectionary, group weeks, finalize themes.
export function canDecide(role) {
  return role === 'pastor' || role === 'office_admin';
}

// Some panels are pastor-only (the sermon/resource intelligence panel
// in phase 3, for example).
export function canSeePastorOnlyPanels(role) {
  return role === 'pastor';
}
