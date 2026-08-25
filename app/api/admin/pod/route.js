import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { getSession, isAdmin } from '../../../../lib/auth';
import { podPhotoPath, orderSignaturePath } from '../../../../lib/pod';
import { jobPhotoPath, jobSignaturePath } from '../../../../lib/driver-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin-only proxy that streams a PRIVATE POD blob (photo by id, or an order's
// signature). The blob URLs are never exposed; only an admin session can read.
export async function GET(req) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return new NextResponse('Not authorized', { status: 403 });

  const url = new URL(req.url);
  const photoId = url.searchParams.get('photo');
  const sigOrder = url.searchParams.get('sig');
  // The same proof, captured against a dispatch JOB rather than an order — a
  // service call has no order behind it, and its photos would otherwise be
  // write-only.
  const jobPhotoId = url.searchParams.get('jobphoto');
  const jobSig = url.searchParams.get('jobsig');
  let pathname = null;
  if (photoId) pathname = await podPhotoPath(Number(photoId));
  else if (sigOrder) pathname = await orderSignaturePath(Number(sigOrder));
  else if (jobPhotoId) pathname = await jobPhotoPath(Number(jobPhotoId));
  else if (jobSig) pathname = await jobSignaturePath(Number(jobSig));
  if (!pathname) return new NextResponse('Not found', { status: 404 });

  try {
    const res = await get(pathname, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) return new NextResponse('Not found', { status: 404 });
    return new Response(res.stream, {
      headers: {
        'Content-Type': res.blob?.contentType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=60'
      }
    });
  } catch (e) {
    console.error('admin pod get failed', e.message);
    return new NextResponse('Error', { status: 500 });
  }
}
