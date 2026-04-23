import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// ../lib imports: esbuild picks ../lib/tsconfig.json so we do not inherit ../tsconfig.json (Expo).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@dojo/lib": path.resolve(__dirname, "../lib"),
    },
  },
  server: {
    port: 5180,
    host: true,
  },
  build: {
    // 브라우저 캐시 효율을 위해 vendor와 tRPC를 별도 청크로 분리한다.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          trpc: ["@trpc/client", "@trpc/server", "superjson"],
        },
      },
    },
    // 소스맵은 개발/디버깅용; 프로덕션 배포 전 필요 시 false로 전환.
    sourcemap: true,
    // 청크 크기 경고 기준을 500KB로 낮춰 큰 번들이 들어오면 알 수 있게 한다.
    chunkSizeWarningLimit: 500,
  },
});
