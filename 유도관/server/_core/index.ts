import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { getSessionCookieOptions } from "./cookies";
import { createCorsMiddleware } from "./cors-middleware";
import { COOKIE_NAME } from "../../shared/const.js";
import { startScheduler } from "../scheduler";
import { getEnvDiagnostics, logRequiredEnvDiagnostics } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, "0.0.0.0", () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  logRequiredEnvDiagnostics();

  const app = express();
  const server = createServer(app);

  if (process.env.NODE_ENV === "production" && process.env.TRUST_PROXY !== "0") {
    app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
  }

  app.use(createCorsMiddleware());

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // 간단한 로그아웃 REST 엔드포인트 (클라이언트 호환성 유지).
  // 실제 세션/가입/로그인은 tRPC auth 라우터로 처리된다.
  app.post("/api/logout", (req, res) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    res.json({ success: true });
  });

  app.get("/api/health", (_req, res) => {
    const env = getEnvDiagnostics();
    res.json({
      ok: true,
      timestamp: Date.now(),
      env: {
        ok: env.ok,
        missing: env.missing,
        invalid: env.invalid,
      },
    });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(`[api] server listening on http://0.0.0.0:${port}`);
    // 납부 만료 D-7 자동 알림 스케줄러 시작
    startScheduler();
  });
}

startServer().catch(console.error);
