// Public endpoint that serves Sarah's spoken replies as mp3, so Twilio can fetch
// them as WhatsApp voice notes. The id is an unguessable token minted per reply
// (see lib/sarah-audio); rows expire after ~1 hour. No auth — Twilio's media
// fetch is anonymous — but the token is single-use-ish and short-lived.
import { getAudio } from '../../../../../lib/sarah-audio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const id = String(params?.id || '').replace(/\.mp3$/i, '');
  const bytes = await getAudio(id);
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=3600'
    }
  });
}
