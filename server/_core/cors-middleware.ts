import type { RequestHandler } from "express";

/**
 * CORS with credentials. If `CORS_ALLOWED_ORIGINS` is set (comma-separated),
 * only those origins get `Access-Control-Allow-Origin`. If unset, the
 * request `Origin` header is echoed (dev-friendly).
 */
export function createCorsMiddleware(): RequestHandler {
  const allowList =
    process.env.CORS_ALLOWED_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  return (req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin.length > 0) {
      if (allowList.length === 0 || allowList.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
      }
    }

    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  };
}
