import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { isKafkaReady } from "./config/kafka.js";
import { isMailConfigured } from "./config/mailer.js";
import { isRabbitReady } from "./config/rabbitmq.js";
import authRoutes from "./modules/auth/auth.routes.js";
import productRoutes from "./modules/products/product.routes.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/error.middleware.js";

const app = express();

app.disable("x-powered-by");

// Small, dependency-free set of security headers for a JSON API.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});

// The dashboard may be opened as `localhost`, `127.0.0.1` or `[::1]` — all
// of which are the same machine, so treat them as one origin. Anything else
// must match FRONTEND_URL exactly.
const frontendOrigin = new URL(env.FRONTEND_URL);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isTrustedOrigin(origin: string): boolean {
  if (origin === env.FRONTEND_URL) return true;

  try {
    const candidate = new URL(origin);

    return (
      candidate.protocol === frontendOrigin.protocol &&
      candidate.port === frontendOrigin.port &&
      LOOPBACK_HOSTS.has(candidate.hostname)
    );
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests without an Origin header (curl, server-to-server) are allowed.
      if (origin === undefined || isTrustedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    // Required for the browser to accept and send the httpOnly refresh cookie.
    credentials: true,
  }),
);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend is running",
    messaging: {
      kafka: isKafkaReady(),
      rabbitmq: isRabbitReady(),
    },
    mail: isMailConfigured() ? "smtp" : "console",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
