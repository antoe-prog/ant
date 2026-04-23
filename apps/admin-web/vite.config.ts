import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 프로덕션 빌드 결과물은 services/gateway/app/web-dist 로 출력해서
// FastAPI가 그대로 정적 서빙할 수 있도록 한다.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // 개발(vite dev)은 루트 '/'에서 서빙되고,
  // 프로덕션 빌드는 gateway의 /admin/ 경로 아래에서 서빙된다.
  base: command === "build" ? "/admin/" : "/",
  server: {
    port: 5173,
    /** 같은 Wi-Fi의 휴대폰 브라우저에서 접속하려면 0.0.0.0 바인딩 필요 */
    host: true,
  },
  build: {
    outDir: "../../services/gateway/app/web-dist",
    emptyOutDir: true,
    sourcemap: false,
  },
}));
