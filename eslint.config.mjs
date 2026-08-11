import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**",
    "out/**",
    "build/**",
    "**/build/**",
    ".data/**",
    ".data/xcode-derived/**",
    ".data/mobile-builds/ios/**/DerivedData/**",
    "tmp/**",
    ".claude/**",
    "mobile/android-cap/app/build/**",
    "mobile/ios-web/**",
    "mobile/ios/App/App/public/**",
    "native/**/build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
