const API = process.env.API_ORIGIN || 'http://127.0.0.1:4000';
/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  async rewrites() {
    return [
      // Same-origin proxy to the Express API so the httpOnly session cookie "just works"
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      // The approved marketing site lives untouched in /public and is served as before
      { source: '/', destination: '/index.html' },
    ];
  },
  async headers() {
    const noStore = [{ key: 'Cache-Control', value: 'no-store, max-age=0' }];
    return [
      { source: '/dashboard/:path*', headers: noStore },
      { source: '/admin/:path*', headers: noStore },
      { source: '/change-password', headers: noStore },
    ];
  },
};
