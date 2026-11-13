// Workshop applications board: the columns and note kinds. NO imports: the board runs in the browser too.
export const WORKSHOP_STATUSES = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['waitlist', 'Waitlist'],
  ['enrolled', 'Enrolled'],
  ['declined', 'Declined'],
  ['junk', 'Junk']
];
export const STATUS_KEYS = WORKSHOP_STATUSES.map(([k]) => k);
export const NOTE_KINDS = [
  ['spoke', 'Spoke to them'],
  ['tried', 'Tried, no answer'],
  ['note', 'Note only']
];
export const NOTE_KEYS = NOTE_KINDS.map(([k]) => k);
export const MAX_NOTE = 2000;
