// ONE database for every test file that drives the real /api/checkout route.
//
// The route's runtime-DDL helpers (ensureAttributionColumns, ensureCouponSchema, ensureOrderLineKind…)
// memoise "done" in module scope, and test files share one Node process — so a second FRESH database
// would never receive the columns the first one got, and checkout would fail with "column does not
// exist". Real deployments have one database; these files share one too.
//
// Each call RE-INSTALLS it as the app's database, because another test file may have installed its own
// (and released it) in between.
//
// Not a *.test.mjs, so the runner does not treat it as a test.
import { withTestDb } from './db.mjs';
import { __useTestDatabase } from '../lib/db.js';

let shared = null;
export async function sharedCheckoutDb() {
  shared ||= await withTestDb();
  __useTestDatabase(shared.client);
  return shared;
}
