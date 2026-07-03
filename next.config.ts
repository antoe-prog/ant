import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.35.22"],
  devIndicators: false,
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*"],
  },
};

export default nextConfig;
