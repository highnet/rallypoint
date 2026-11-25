import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The swarm UI only reads. No images, no rewrites, no telemetry of its own.
  poweredByHeader: false,
};

export default nextConfig;
