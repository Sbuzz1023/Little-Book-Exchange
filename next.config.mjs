/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Listing photos are resized in the browser (lib/resizeImage.ts), but three
    // of them plus the form still top Next's 1 MB default. Stay under Vercel's
    // 4.5 MB request cap.
    serverActions: { bodySizeLimit: '4mb' },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'qlctujyuupighlvzryva.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'covers.openlibrary.org',
        pathname: '/b/id/**',
      },
    ],
  },
};

export default nextConfig;
