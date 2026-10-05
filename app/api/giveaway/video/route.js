import { NextResponse } from 'next/server';
import { handleUpload } from '@vercel/blob/client';
import { GIVEAWAY, giveawayOpen } from '../../../../lib/deals-config';
import { entryIdFromParam, videoPrefix } from '../../../../lib/giveaway';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Hands the browser a short-lived token to upload a video STRAIGHT to the
// private Blob store. A phone video is tens of megabytes, far past what a
// serverless function accepts in a request body, so it cannot come through us.
//
// What this route enforces is where the file may land: only under THIS entry's
// prefix, only video types, only up to the size cap, and with a random suffix so
// it cannot be guessed or overwritten. Registering the finished upload against
// the entry happens afterwards, in /api/giveaway/bonus, which re-checks the prefix.
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const id = entryIdFromParam(clientPayload);
        if (!id) throw new Error('That link is not valid.');
        if (!giveawayOpen()) throw new Error('This giveaway is no longer taking entries.');
        if (!pathname.startsWith(videoPrefix(GIVEAWAY.id, id))) throw new Error('Unexpected upload location.');
        return {
          allowedContentTypes: VIDEO_TYPES,
          maximumSizeInBytes: MAX_VIDEO_BYTES,
          addRandomSuffix: true,
          tokenPayload: String(id)
        };
      }
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Upload not allowed.' }, { status: 400 });
  }
}
