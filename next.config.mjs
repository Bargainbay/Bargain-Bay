/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'drive.google.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' }
    ]
  },
  experimental: {
    // /api/admin/migrate reads db/schema.sql at runtime — make sure the file
    // ships with the serverless function on Vercel.
    outputFileTracingIncludes: {
      '/api/admin/migrate': ['./db/schema.sql']
    }
  }
};
export default nextConfig;
