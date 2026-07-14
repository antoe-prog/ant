import type { NextConfig } from "next";

const isolatedDistDir = process.env.FINAL_JUDO_NEXT_DIST_DIR?.trim();
const isolatedTsconfigPath = process.env.FINAL_JUDO_NEXT_TSCONFIG_PATH?.trim();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.35.22"],
  devIndicators: false,
  ...(isolatedDistDir ? { distDir: isolatedDistDir } : {}),
  ...(isolatedTsconfigPath ? { typescript: { tsconfigPath: isolatedTsconfigPath } } : {}),
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*"],
  },
};

export default nextConfig;
