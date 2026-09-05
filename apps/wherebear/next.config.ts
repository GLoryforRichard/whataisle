import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app keeps its npm lockfile and builds independently within the repo.
  turbopack: { root: process.cwd() },
  // Phone album shots are often 10–20 MB HEIC/JPEG. Next's proxy buffer
  // defaults to 10 MB and a truncated multipart then fails as FormData.
  experimental: {
    proxyClientMaxBodySize: '25mb',
    serverActions: { bodySizeLimit: '25mb' },
  },
};

export default nextConfig;
