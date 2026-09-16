// Labels shared by the parts screens and the parts module.
//
// IMPORTS NOTHING — components/Parts.jsx runs in the browser, and lib/parts.js
// imports lib/db, which must never be dragged into a client bundle. Same reason
// lib/location-codes.js is separate from lib/locations.js.
export const PART_CONDITIONS = { new: 'New', used: 'Used' };

export const MOVE_REASONS = {
  harvest: 'Cut out of a salvage unit',
  purchase: 'Bought in',
  use_unit: 'Used on a repair',
  use_job: 'Used on a service call',
  sale: 'Sold',
  count: 'Found in a count',
  adjust: 'Correction'
};

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'picked', 'cancelled'];
