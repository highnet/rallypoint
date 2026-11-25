import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Short, memorable ways into the Swarm wizard.
  async redirects() {
    return [
      { source: "/wizard", destination: "/swarm/wizard", permanent: false },
      { source: "/start", destination: "/swarm/wizard", permanent: false },
    ];
  },
};

export default nextConfig;
