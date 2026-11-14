import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // --- Authentication -------------------------------------------------------
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be 32+ chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be 32+ chars"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  /**
   * `false` keeps the refresh cookie usable over plain http (local dev and the
   * docker compose stack). Set to `true` whenever the API is served over HTTPS.
   */
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Requests allowed per window, per IP, on the login endpoint. */
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  /** Requests allowed per window, per IP, on the register endpoint. */
  REGISTER_RATE_LIMIT: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  /**
   * Secret peppered into the HMAC that stores password-reset codes, so a
   * leaked database alone cannot be replayed. Falls back to the refresh-token
   * secret when unset, which is already required to be a strong value.
   */
  PASSWORD_RESET_PEPPER: z.string().default(""),

  // --- E-mail (Nodemailer) --------------------------------------------------
  /** Leave empty to print e-mails to the console instead of sending them. */
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  MAIL_FROM: z
    .string()
    .min(1)
    .default("Product Monitor <no-reply@product-monitor.local>"),

  // --- Messaging ------------------------------------------------------------
  KAFKA_BROKERS: z
    .string()
    .default("localhost:9094")
    .transform((value) =>
      value
        .split(",")
        .map((broker) => broker.trim())
        .filter(Boolean),
    )
    .refine((brokers) => brokers.length > 0, {
      message: "KAFKA_BROKERS must contain at least one broker",
    }),
  KAFKA_TOPIC: z.string().min(1).default("product.events"),
  KAFKA_CONSUMER_GROUP: z.string().min(1).default("product-management-events"),
  KAFKA_AUTH_TOPIC: z.string().min(1).default("auth.events"),
  KAFKA_AUTH_CONSUMER_GROUP: z
    .string()
    .min(1)
    .default("product-management-auth"),
  RABBITMQ_URL: z.string().min(1).default("amqp://guest:guest@localhost:5672"),
  RABBITMQ_EXCHANGE: z.string().min(1).default("product.events"),
  RABBITMQ_QUEUE: z.string().min(1).default("product.notifications"),
  RABBITMQ_AUTH_EXCHANGE: z.string().min(1).default("auth.events"),
  RABBITMQ_AUTH_QUEUE: z.string().min(1).default("auth.notifications"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;

if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  console.error(
    "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.",
  );
  process.exit(1);
}
