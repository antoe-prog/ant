// https://docs.expo.dev/guides/using-eslint/
import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // web-admin은 vite 별칭(@dojo/lib)과 자체 node_modules를 쓰므로
    // Expo 쪽 import resolver가 경로를 못 찾는다(vite/tsc에서 이미 검증됨).
    files: ["web-admin/**"],
    rules: {
      "import/no-unresolved": "off",
    },
  },
]);
