// A sheet, held still while somebody decides what to do with it.
//
// The importer used to keep the whole thing in the browser: rows, mapping,
// which client it was for, all of it in React state that died with the tab. Two
// consequences, and both of them are the complaint this module answers.
//
// The first is that nothing could be reviewed except by the person who uploaded
// it, in that tab, right then. An approval that arrives by PHONE — the owner
// walking the yard while the office uploads — has nowhere to read the rows from
// and nowhere to write an answer back to.
//
// The second is that the app learned nothing. The same client sends the same
// spreadsheet every week, and every week somebody re-pointed the same columns
// and re-picked the same company, because the previous time existed only in a
// closed tab. A staged batch has a fingerprint, and a fingerprint has a memory.
//
// So: an upload STAGES. Nothing reaches the board until a batch is approved,
// and approving is one call that either the screen or the voice agent can make.
import { hasDb, query } from './db';
import { createJob, ensureJobSchema, listClients } from './jobs';
import { toJobs, guessMapping, fingerprintHeaders } from './stop-import';
import { clientFromFilename, matchClient, normalizeName } from './client-match';

const clean = (v, max = 300) => {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, max) : null;
};

let _schema = null;
export function ensureImportSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = ensureJobSchema().then(() => query(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id serial PRIMARY KEY,
        batch_number text UNIQUE,
        status text NOT NULL DEFAULT 'draft',
        source_name text,
        read_as text,
        client_id int,
        job_date date,
        quebec_rule boolean NOT NULL DEFAULT true,
        headers jsonb NOT NULL DEFAULT '[]'::jsonb,
        rows jsonb NOT NULL DEFAULT '[]'::jsonb,
        mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
        -- Per-row corrections, keyed by row index: an address read out over the
        -- phone, a client set on one stop, a row dropped. Kept SEPARATE from
        -- the rows themselves so the sheet as it arrived is never overwritten —
        -- "what did their spreadsheet actually say" is the first question asked
        -- when a stop turns out wrong.
        overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        fingerprint text,
        note text,
        created_by text, created_by_name text,
        created_at timestamptz DEFAULT now(),
        decided_at timestamptz,
        job_ids int[]
      );
      CREATE INDEX IF NOT EXISTS idx_import_batches_open
        ON import_batches (created_at DESC) WHERE status = 'draft';

      -- What a client's spreadsheet looks like, remembered.
      CREATE TABLE IF NOT EXISTS client_sheet_profiles (
        id serial PRIMARY KEY,
        fingerprint text NOT NULL UNIQUE,
        client_id int,
        headers jsonb,
        mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
        defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
        hits int NOT NULL DEFAULT 1,
        last_used timestamptz DEFAULT now(),
        updated_by text
      );

      -- The other names a client goes by. Learned from answers, never invented:
      -- somebody says "yes, CDA is Canadian Discount Appliances" exactly once.
      CREATE TABLE IF NOT EXISTS client_aliases (
        id serial PRIMARY KEY,
        client_id int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        alias text NOT NULL,
        alias_norm text NOT NULL,
        created_by text,
        created_at timestamptz DEFAULT now(),
        UNIQUE (client_id, alias_norm)
      );
    `));
  }
  return _schema;
}

// ── Aliases ─────────────────────────────────────────────────────────────────
export async function listClientAliases() {
  if (!hasDb()) return {};
  await ensureImportSchema();
  const { rows } = await query('SELECT client_id, alias FROM client_aliases');
  const by = {};
  for (const r of rows) (by[r.client_id] ||= []).push(r.alias);
  return by;
}

export async function addClientAlias(clientId, alias, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureImportSchema();
  const a = clean(alias, 120);
  const norm = normalizeName(a);
  if (!a || !norm) throw new Error('That alias is empty.');
  if (!clientId) throw new Error('An alias needs a client to point at.');
  const { rows } = await query(
    `INSERT INTO client_aliases (client_id, alias, alias_norm, created_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (client_id, alias_norm) DO UPDATE SET alias = EXCLUDED.alias
     RETURNING *`,
    [Number(clientId), a, norm, by?.email || null]
  );
  return rows[0];
}

// ── Staging ─────────────────────────────────────────────────────────────────

// Everything we know about who a sheet belongs to, in the order the signals
// deserve to be trusted. A remembered profile beats a filename beats a guess —
// and a guess is offered, never applied.
async function detectClient({ headers, rows, mapping, fingerprint, sourceName, clients, aliases }) {
  // 1. This exact sheet has been imported before.
  if (fingerprint) {
    const { rows: prof } = await query(
      'SELECT client_id, mapping, defaults, hits FROM client_sheet_profiles WHERE fingerprint = $1',
      [fingerprint]
    );
    if (prof[0]?.client_id && clients.some((c) => c.id === prof[0].client_id)) {
      const c = clients.find((x) => x.id === prof[0].client_id);
      return {
        clientId: c.id, confident: true,
        why: `this is ${c.name}’s sheet — same columns as ${prof[0].hits === 1 ? 'last time' : `the last ${prof[0].hits} imports`}`,
        profile: prof[0]
      };
    }
    if (prof[0]) return { clientId: null, confident: false, why: null, profile: prof[0] };
  }

  // 2. The sheet names a client on its rows. Only when it agrees with ITSELF —
  //    a sheet carrying three companies has no single answer and must not be
  //    forced into one.
  if (mapping.clientName != null) {
    const names = [...new Set(rows.map((r) => String(r[mapping.clientName] || '').trim()).filter(Boolean))];
    const matches = names.map((n) => matchClient(n, clients, aliases));
    const ids = [...new Set(matches.filter((m) => m.confident).map((m) => m.clientId))];
    if (ids.length === 1 && matches.every((m) => m.confident)) {
      const c = clients.find((x) => x.id === ids[0]);
      return { clientId: c.id, confident: true, why: `every row says ${c.name}`, profile: null };
    }
    if (ids.length > 1) {
      return {
        clientId: null, confident: false, profile: null,
        why: `this sheet has ${ids.length} different clients on it — each stop keeps its own`
      };
    }
  }

  // 3. The filename.
  const byFile = clientFromFilename(sourceName, clients, aliases);
  if (byFile.confident) return { clientId: byFile.clientId, confident: true, why: byFile.why, profile: null };

  return { clientId: null, confident: false, why: null, profile: null, suggest: byFile.alternatives || [] };
}

export async function stageBatch({
  headers = [], rows = [], sourceName, readAs = 'paste', jobDate, clientId, createdBy
} = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureImportSchema();
  if (!rows.length) throw new Error('There are no rows in that.');

  const [clients, aliases] = await Promise.all([listClients(), listClientAliases()]);
  const fingerprint = fingerprintHeaders(headers);

  const detected = await detectClient({
    headers, rows, mapping: guessMapping(headers), fingerprint,
    sourceName, clients, aliases
  });
  // A remembered mapping is the whole point of remembering: the dispatcher
  // pointed these columns once already.
  const mapping = detected.profile?.mapping && Object.keys(detected.profile.mapping).length
    ? detected.profile.mapping
    : guessMapping(headers);

  const defaults = detected.profile?.defaults || {};
  const author = {
    email: String(createdBy?.email || '').trim().toLowerCase() || null,
    name: String(createdBy?.name || '').trim() || null
  };

  const { rows: made } = await query(
    `INSERT INTO import_batches
       (source_name, read_as, client_id, job_date, quebec_rule, headers, rows, mapping, fingerprint,
        created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [clean(sourceName, 200), readAs,
     clientId ? Number(clientId) : detected.clientId,
     jobDate || null,
     defaults.quebecRule === false ? false : true,
     JSON.stringify(headers), JSON.stringify(rows), JSON.stringify(mapping),
     fingerprint, author.email, author.name]
  );
  const id = made[0].id;
  const { rows: num } = await query(
    `UPDATE import_batches SET batch_number = 'IMP-' || (1000 + id) WHERE id = $1 RETURNING batch_number`,
    [id]
  );
  const batch = await resolveBatch(id);
  return { ...batch, batchNumber: num[0].batch_number, detected };
}

// ── Reading one back ────────────────────────────────────────────────────────

// The batch as everything downstream wants it: the rows turned into stops, each
// carrying its problems, with the corrections already applied. One function,
// because the screen and the voice agent disagreeing about what row 4 says is
// the failure this whole thing exists to avoid.
export async function resolveBatch(id) {
  if (!hasDb()) return null;
  await ensureImportSchema();
  const { rows: found } = await query('SELECT * FROM import_batches WHERE id = $1', [Number(id)]);
  const b = found[0];
  if (!b) return null;

  const [clients, aliases] = await Promise.all([listClients(), listClientAliases()]);
  const clientName = clients.find((c) => c.id === b.client_id)?.name || null;

  const parsed = toJobs(b.rows || [], b.mapping || {}, {
    clientId: b.client_id,
    clientName,
    jobDate: b.job_date ? new Date(b.job_date).toISOString().slice(0, 10) : null,
    quebecRule: b.quebec_rule,
    clients,
    aliasesByClient: aliases
  });

  const overrides = b.overrides || {};
  const stops = parsed.map((p, i) => {
    const ov = overrides[String(i)] || {};
    // An override is a person's answer and outranks anything read off a cell.
    const job = { ...p.job };
    for (const [k, v] of Object.entries(ov)) {
      if (k === 'drop' || k === 'answered') continue;
      job[k] = v;
    }
    // Correcting the thing that blocked the row un-blocks it — recompute rather
    // than carrying the original verdict forward.
    const problems = p.problems.filter((pr) => {
      if (pr.kind === 'no_address' && job.address) return false;
      if (pr.kind === 'no_pickup' && job.pickupAddress) return false;
      if (pr.kind === 'no_date' && job.jobDate) return false;
      if ((pr.kind === 'client_unknown' || pr.kind === 'client_unsure') && ov.clientId !== undefined) return false;
      return true;
    });
    return {
      index: i,
      job,
      problems,
      sheetClient: p.sheetClient,
      dropped: !!ov.drop,
      corrected: Object.keys(ov).filter((k) => k !== 'drop').length > 0,
      blocking: !job.address || (job.quebec && !job.pickupAddress),
      needsReview: problems.some((pr) => !pr.info)
    };
  });

  const live = stops.filter((s) => !s.dropped);
  return {
    id: b.id,
    batchNumber: b.batch_number,
    status: b.status,
    sourceName: b.source_name,
    readAs: b.read_as,
    clientId: b.client_id,
    clientName,
    jobDate: b.job_date ? new Date(b.job_date).toISOString().slice(0, 10) : null,
    quebecRule: b.quebec_rule,
    headers: b.headers || [],
    mapping: b.mapping || {},
    fingerprint: b.fingerprint,
    note: b.note,
    createdBy: b.created_by_name || b.created_by,
    createdAt: b.created_at,
    jobIds: b.job_ids || [],
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    stops,
    summary: {
      rows: stops.length,
      dropped: stops.length - live.length,
      ready: live.filter((s) => !s.blocking).length,
      blocked: live.filter((s) => s.blocking).length,
      needsReview: live.filter((s) => s.needsReview).length,
      // The two questions somebody actually asks out loud.
      days: [...new Set(live.map((s) => s.job.jobDate).filter(Boolean))].sort(),
      clientIds: [...new Set(live.map((s) => s.job.clientId).filter(Boolean))]
    }
  };
}

export async function listOpenBatches({ limit = 10 } = {}) {
  if (!hasDb()) return [];
  await ensureImportSchema();
  const { rows } = await query(
    `SELECT b.id, b.batch_number, b.source_name, b.created_at, b.created_by_name,
            b.job_date, c.name AS client_name, jsonb_array_length(b.rows) AS row_count
       FROM import_batches b
       LEFT JOIN clients c ON c.id = b.client_id
      WHERE b.status = 'draft'
      ORDER BY b.created_at DESC
      LIMIT $1`,
    [Math.min(Number(limit) || 10, 50)]
  );
  return rows.map((r) => ({
    id: r.id, batchNumber: r.batch_number, sourceName: r.source_name,
    createdAt: r.created_at, createdBy: r.created_by_name,
    jobDate: r.job_date ? new Date(r.job_date).toISOString().slice(0, 10) : null,
    clientName: r.client_name, rowCount: Number(r.row_count || 0)
  }));
}

// ── Changing one ────────────────────────────────────────────────────────────

// Only what is PASSED is written — the same rule updateJob follows, and for the
// same reason: a caller that doesn't know about a field must never be able to
// blank it. The voice agent in particular sends one thing at a time.
export async function patchBatch(id, patch = {}, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureImportSchema();
  const { rows: found } = await query('SELECT status, overrides FROM import_batches WHERE id = $1', [Number(id)]);
  if (!found[0]) throw new Error('That import is no longer here.');
  if (found[0].status !== 'draft') throw new Error(`That import was already ${found[0].status}.`);

  const sets = [];
  const vals = [Number(id)];
  const put = (col, v) => { if (v !== undefined) { vals.push(v); sets.push(`${col} = $${vals.length}`); } };

  put('client_id', patch.clientId === undefined ? undefined : (patch.clientId ? Number(patch.clientId) : null));
  put('job_date', patch.jobDate === undefined ? undefined : (patch.jobDate || null));
  put('quebec_rule', patch.quebecRule === undefined ? undefined : !!patch.quebecRule);
  put('mapping', patch.mapping === undefined ? undefined : JSON.stringify(patch.mapping));
  put('note', patch.note === undefined ? undefined : clean(patch.note, 500));

  // Row-level corrections merge in rather than replacing the lot, so two
  // answers about two different stops can't undo each other.
  if (patch.rowOverrides && typeof patch.rowOverrides === 'object') {
    const merged = { ...(found[0].overrides || {}) };
    for (const [k, v] of Object.entries(patch.rowOverrides)) {
      if (v === null) delete merged[k];
      else merged[k] = { ...(merged[k] || {}), ...v };
    }
    put('overrides', JSON.stringify(merged));
  }

  if (sets.length) await query(`UPDATE import_batches SET ${sets.join(', ')} WHERE id = $1`, vals);
  return resolveBatch(id);
}

// "Everything on this sheet is for X." The blunt instrument, and the one that
// answers the actual complaint — it sets the batch default AND clears any
// per-row client the sheet had opinions about.
export async function setBatchClient(id, clientId, { everyRow = true } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureImportSchema();
  const b = await resolveBatch(id);
  if (!b) throw new Error('That import is no longer here.');
  if (b.status !== 'draft') throw new Error(`That import was already ${b.status}.`);

  const rowOverrides = {};
  if (everyRow) {
    for (const s of b.stops) rowOverrides[String(s.index)] = { clientId: clientId ? Number(clientId) : null };
  }
  return patchBatch(id, { clientId: clientId ? Number(clientId) : null, rowOverrides });
}

export async function cancelBatch(id, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureImportSchema();
  await query(
    `UPDATE import_batches SET status = 'cancelled', decided_at = now() WHERE id = $1 AND status = 'draft'`,
    [Number(id)]
  );
  return resolveBatch(id);
}

// ── Approving ───────────────────────────────────────────────────────────────

// The only path from a sheet to the board. Everything above this line is
// reversible; this is the line.
export async function approveBatch(id, by) {
  if (!hasDb()) throw new Error('Database not configured.');
  const b = await resolveBatch(id);
  if (!b) throw new Error('That import is no longer here.');
  if (b.status !== 'draft') throw new Error(`That import was already ${b.status}.`);

  const going = b.stops.filter((s) => !s.dropped && !s.blocking);
  if (!going.length) throw new Error('Nothing on that sheet can be added yet.');

  const created = [];
  const failed = [];
  for (const s of going) {
    try {
      const job = await createJob({ ...s.job, source: 'import', createdBy: by });
      created.push({ row: s.index + 1, job: job.jobNumber, id: job.id, customerName: s.job.customerName || null });
    } catch (e) {
      // One bad row must not cost the other twenty-nine.
      failed.push({ row: s.index + 1, customerName: s.job.customerName || null, address: s.job.address || null, error: e?.message || 'could not be added' });
    }
  }

  await query(
    `UPDATE import_batches SET status = 'approved', decided_at = now(), job_ids = $2 WHERE id = $1`,
    [Number(id), created.map((c) => c.id)]
  );

  // Learn the sheet. Only from an import somebody actually approved — a mapping
  // remembered off a draft nobody accepted would teach it the wrong lesson.
  if (b.fingerprint) {
    await query(
      `INSERT INTO client_sheet_profiles (fingerprint, client_id, headers, mapping, defaults, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (fingerprint) DO UPDATE SET
         client_id = COALESCE(EXCLUDED.client_id, client_sheet_profiles.client_id),
         mapping = EXCLUDED.mapping,
         defaults = EXCLUDED.defaults,
         headers = EXCLUDED.headers,
         hits = client_sheet_profiles.hits + 1,
         last_used = now(),
         updated_by = EXCLUDED.updated_by`,
      [b.fingerprint, b.clientId, JSON.stringify(b.headers), JSON.stringify(b.mapping),
       JSON.stringify({ quebecRule: b.quebecRule }), by?.email || null]
    );
  }

  return { added: created.length, created, failed, skipped: b.summary.dropped + b.summary.blocked, batchNumber: b.batchNumber };
}

// What the batch needs answered, as sentences. The voice agent reads these out;
// the screen prints the same list, so the two can never describe a sheet
// differently.
export function openQuestions(batch) {
  const qs = [];
  if (!batch) return qs;
  const live = batch.stops.filter((s) => !s.dropped);

  if (!batch.clientId && !batch.summary.clientIds.length) {
    qs.push({ kind: 'client', scope: 'batch', text: 'Who is this sheet for? No client is set on it.' });
  }
  if (!batch.summary.days.length) {
    qs.push({ kind: 'date', scope: 'batch', text: 'No day is set, so these would all wait in “To assign”. What day are they for?' });
  } else if (batch.summary.days.length > 1) {
    qs.push({ kind: 'date', scope: 'batch', text: `This sheet spans ${batch.summary.days.length} days: ${batch.summary.days.join(', ')}.` });
  }
  for (const s of live) {
    for (const p of s.problems) {
      if (p.info) continue;
      qs.push({
        kind: p.kind, scope: 'row', row: s.index,
        blocking: !!p.blocking,
        text: `Row ${s.index + 1}${s.job.customerName ? `, ${s.job.customerName}` : ''}${s.job.city ? ` in ${s.job.city}` : ''} — ${p.text}`,
        suggest: p.suggest || null
      });
    }
  }
  return qs;
}
