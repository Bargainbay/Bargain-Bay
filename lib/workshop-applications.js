// The staff side of workshop applications (/admin/workshop): a kanban board over workshop_applications.
//
// RULES THAT MUST HOLD (tests in test/workshop-applications.test.mjs):
//  - "Spoke to them" is its own fact, NOT a column. Any card in any column is either spoken-to or not, and the board shows which.
//  - What was discussed is an APPEND-ONLY log (workshop_application_notes). A correction is a new note. The author comes from the
//    SESSION, never the request body.
//  - JUNK is a status, never a delete: a fake applicant's details are exactly what we want to recognise next time.
//  - Moving a card never changes the spoken flag; only logging "spoke" (or the toggle) does.
import { hasDb, query, withTransaction } from './db';
import { STATUS_KEYS, NOTE_KEYS, MAX_NOTE } from './workshop-rules';

export class WorkshopError extends Error { constructor(m, code) { super(m); this.code = code; } }

// Idempotent, and the same as db/migrations/0072: works the moment it is deployed, with nothing to press.
let ensured = null;
export function ensureWorkshopSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!ensured) {
    ensured = query(`
      DO $$
      DECLARE c text;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workshop_applications_status_check' AND pg_get_constraintdef(oid) ILIKE '%junk%') THEN
          FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'workshop_applications'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%status%' LOOP
            EXECUTE format('ALTER TABLE workshop_applications DROP CONSTRAINT %I', c);
          END LOOP;
          ALTER TABLE workshop_applications ADD CONSTRAINT workshop_applications_status_check CHECK (status IN ('new','contacted','enrolled','declined','waitlist','junk'));
        END IF;
      END $$;
      ALTER TABLE workshop_applications ADD COLUMN IF NOT EXISTS spoken_to boolean NOT NULL DEFAULT false;
      ALTER TABLE workshop_applications ADD COLUMN IF NOT EXISTS spoken_at timestamptz;
      ALTER TABLE workshop_applications ADD COLUMN IF NOT EXISTS spoken_by text;
      ALTER TABLE workshop_applications ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
      CREATE TABLE IF NOT EXISTS workshop_application_notes (
        id bigserial PRIMARY KEY,
        application_id bigint NOT NULL REFERENCES workshop_applications(id) ON DELETE CASCADE,
        kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('note','spoke','tried')),
        body text NOT NULL, by_email text, by_name text, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_workshop_notes_app ON workshop_application_notes (application_id, created_at DESC);
    `).catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

const who = (v) => ({ email: String(v?.email || '').toLowerCase() || null, name: v?.name || v?.email || null });

export async function listApplications() {
  await ensureWorkshopSchema();
  const { rows } = await query(`
    SELECT a.id, a.cohort, a.name, a.email, a.phone, a.city, a.experience, a.apprenticeship, a.about, a.heard_from, a.status,
           a.spoken_to, a.spoken_at, a.spoken_by, a.created_at, a.status_changed_at,
           (SELECT count(*)::int FROM workshop_application_notes n WHERE n.application_id = a.id) AS note_count,
           (SELECT n.body FROM workshop_application_notes n WHERE n.application_id = a.id ORDER BY n.id DESC LIMIT 1) AS last_note
      FROM workshop_applications a ORDER BY a.created_at DESC LIMIT 1000`);
  return rows;
}

export async function listNotes(id) {
  await ensureWorkshopSchema();
  const { rows } = await query(
    `SELECT id, kind, body, by_name, created_at FROM workshop_application_notes WHERE application_id = $1 ORDER BY id DESC`, [Number(id)]);
  return rows;
}

export async function setStatus(ids, status) {
  await ensureWorkshopSchema();
  if (!STATUS_KEYS.includes(status)) throw new WorkshopError('Unknown column.', 'bad');
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isInteger))].slice(0, 200);
  if (!list.length) throw new WorkshopError('Nothing selected.', 'bad');
  const r = await query(
    `UPDATE workshop_applications SET status = $2, status_changed_at = now() WHERE id = ANY($1::bigint[]) AND status <> $2 RETURNING id`, [list, status]);
  return { ok: true, changed: r.rows.length };
}

export async function setSpoken(id, spoken, viewer) {
  await ensureWorkshopSchema();
  const v = who(viewer);
  const r = spoken
    ? await query(`UPDATE workshop_applications SET spoken_to = true, spoken_at = COALESCE(spoken_at, now()), spoken_by = COALESCE(spoken_by, $2) WHERE id = $1 RETURNING id`, [Number(id), v.name])
    : await query(`UPDATE workshop_applications SET spoken_to = false, spoken_at = NULL, spoken_by = NULL WHERE id = $1 RETURNING id`, [Number(id)]);
  if (!r.rows.length) throw new WorkshopError('Application not found.', 'missing');
  return { ok: true };
}

// Logs what happened. "spoke" also flips the spoken flag, in the same transaction, so the two can never disagree.
export async function addNote(id, { kind = 'note', body }, viewer) {
  await ensureWorkshopSchema();
  if (!NOTE_KEYS.includes(kind)) throw new WorkshopError('Unknown note type.', 'bad');
  const text = String(body || '').trim().slice(0, MAX_NOTE);
  if (!text) throw new WorkshopError('Write what was discussed first.', 'bad');
  const v = who(viewer);
  return withTransaction(async (c) => {
    const exists = await c.query(`SELECT id FROM workshop_applications WHERE id = $1 FOR UPDATE`, [Number(id)]);
    if (!exists.rows.length) throw new WorkshopError('Application not found.', 'missing');
    await c.query(`INSERT INTO workshop_application_notes (application_id, kind, body, by_email, by_name) VALUES ($1,$2,$3,$4,$5)`, [Number(id), kind, text, v.email, v.name]);
    if (kind === 'spoke') {
      await c.query(`UPDATE workshop_applications SET spoken_to = true, spoken_at = COALESCE(spoken_at, now()), spoken_by = COALESCE(spoken_by, $2) WHERE id = $1`, [Number(id), v.name]);
    }
    return { ok: true };
  });
}
