/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'drive.google.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' }
    ]
  },
  // /api/admin/migrate reads db/schema.sql at runtime — make sure the file
  // ships with the serverless function on Vercel. (Stable top-level option
  // since Next 15; was experimental.* on Next 14.)
  outputFileTracingIncludes: {
    '/api/admin/migrate': ['./db/schema.sql']
  }
};
export default nextConfig;
