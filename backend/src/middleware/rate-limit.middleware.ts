import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { redis } from "../config/redis.js";
import { AppError } from "../lib/app-error.js";

interface RateLimitOptions {
  /** Namespace so login and register buckets never collide. */
  keyPrefix: string;
  /** Requests allowed per window per IP. */
  max: number;
  windowSeconds?: number;
  message?: string;
}

interface Window {
  count: number;
  resetAt: number;
}

/** Fallback used whenever Redis is unavailable, so auth never hard-fails. */
const memoryBuckets = new Map<string, Window>();
const MEMORY_SWEEP_INTERVAL = 50;

let sweeps = 0;

function sweepMemoryBuckets(now: number): void {
  if ((sweeps += 1) % MEMORY_SWEEP_INTERVAL !== 0) return;

  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }
}

async function hitRedis(key: string, windowMs: number) {
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.pExpire(key, windowMs);
  }

  const ttl = await redis.pTTL(key);

  return {
    count,
    // A missing TTL means the key expired between INCR and PEXPIRE; treat the
    // window as fully refunded rather than locking the caller out forever.
    resetAt: ttl > 0 ? Date.now() + ttl : Date.now() + windowMs,
  };
}

function hitMemory(key: string, windowMs: number): Window {
  const now = Date.now();
  sweepMemoryBuckets(now);

  let bucket = memoryBuckets.get(key);

  if (bucket === undefined || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    memoryBuckets.set(key, bucket);
  }

  bucket.count += 1;
  return bucket;
}

/**
 * Fixed-window limiter used to blunt credential-stuffing and signup spam.
 * Backed by Redis so the limit survives a restart and is shared across
 * instances, with an in-process fallback when Redis is down.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const windowMs = (options.windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS) * 1000;
  const message =
    options.message ?? "Too many attempts. Please try again shortly.";

  return (req, res, next) => {
    void (async () => {
      const key = `${options.keyPrefix}:${req.ip ?? "unknown"}`;

      let count: number;
      let resetAt: number;

      if (redis.isReady) {
        try {
          ({ count, resetAt } = await hitRedis(key, windowMs));
        } catch (error) {
          console.error("Rate limiter fell back to memory:", error);
          ({ count, resetAt } = hitMemory(key, windowMs));
        }
      } else {
        ({ count, resetAt } = hitMemory(key, windowMs));
      }

      const remaining = Math.max(0, options.max - count);

      res.setHeader("X-RateLimit-Limit", String(options.max));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

      if (count > options.max) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
        next(new AppError(429, message));
        return;
      }

      next();
    })().catch(next);
  };
}
