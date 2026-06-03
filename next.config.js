/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build-time lint is disabled because `next lint` is deprecated in Next 15
  // and CI runs the explicit `npm run lint` step instead. Re-enable once
  // we migrate to eslint flat config (see issue #6).
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;