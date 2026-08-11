import type { NextConfig } from "next";

const isolatedDistDir = process.env.FINAL_JUDO_NEXT_DIST_DIR?.trim();
const isolatedTsconfigPath = process.env.FINAL_JUDO_NEXT_TSCONFIG_PATH?.trim();
const iosLocalBundle = process.env.FINAL_JUDO_IOS_LOCAL_BUNDLE === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.35.22"],
  devIndicators: false,
  ...(iosLocalBundle
    ? {
        images: { unoptimized: true },
        output: "export" as const,
        trailingSlash: true,
      }
    : {}),
  ...(isolatedDistDir ? { distDir: isolatedDistDir } : {}),
  ...(isolatedTsconfigPath ? { typescript: { tsconfigPath: isolatedTsconfigPath } } : {}),
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*"],
  },
};

export default nextConfig;
