import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /** 같은 Wi-Fi의 휴대폰 브라우저에서 접속하려면 0.0.0.0 바인딩 필요 */
    host: true,
  },
});
