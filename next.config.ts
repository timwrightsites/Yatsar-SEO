import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow larger request bodies for long strategy conversations
  // Default is ~1MB — this raises it to 10MB for server actions
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
