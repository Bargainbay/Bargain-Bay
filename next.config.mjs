/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'drive.google.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      // Real per-unit photos from RS Ops (see lib/rsops.js). Its Vercel Blob
      // store serves them in production; the /api/storefront/photo/ path is the
      // fallback RS Ops emits when it isn't running against Blob. Named exactly
      // rather than wildcarded — /_next/image is a public endpoint, and a
      // wildcard here would let anyone resize anything on that host through us.
      { protocol: 'https', hostname: 'jbxxdy5i9levcedo.public.blob.vercel-storage.com' },
      { protocol: 'https', hostname: 'rs-ops.vercel.app', pathname: '/api/storefront/photo/**' }
    ]
  },
  // /api/admin/migrate reads db/migrations/*.sql at runtime — make sure they
  // ship with the serverless function on Vercel. (Stable top-level option since
  // Next 15; was experimental.* on Next 14.)
  //
  // The glob matters: this used to name db/schema.sql exactly, so a migrations
  // DIRECTORY would have deployed empty and the button would have reported
  // "no migrations found" on production while working perfectly in dev.
  outputFileTracingIncludes: {
    '/api/admin/migrate': ['./db/migrations/**/*.sql']
  }
};
export default nextConfig;
