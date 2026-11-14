import { redis } from "../../config/redis.js";
import type { ProductEvent } from "./product-event.schema.js";

/**
 * Rolling activity feed written by the RabbitMQ product consumer and read by
 * `GET /api/products/activity`. Together they make the Kafka -> RabbitMQ hop
 * observable end to end instead of ending in a console line.
 */
export const PRODUCT_ACTIVITY_LIST_KEY = "product:activity";
export const PRODUCT_ACTIVITY_COUNTS_KEY = "product:activity:counts";

/** Entries kept in the feed; older ones fall off the tail. */
const ACTIVITY_LIMIT = 50;
/** Feed and counters expire so Redis never accumulates stale state. */
const ACTIVITY_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface ProductActivityEntry {
  eventId: string;
  type: string;
  productId: number | null;
  occurredAt: string;
  /** Cache/database source, present on fetch events. */
  source?: string;
  /** Product name, present on created/updated events. */
  name?: string;
}

/**
 * Append one event to the feed and bump its per-type counter. Called from
 * the RabbitMQ handler, so failures are logged rather than thrown: a Redis
 * blip must not fail the message ack and trigger a redelivery storm.
 */
export async function recordProductActivity(
  event: ProductEvent,
): Promise<void> {
  if (!redis.isReady) return;

  const entry: ProductActivityEntry = {
    eventId: event.eventId,
    type: event.type,
    productId: event.productId ?? null,
    occurredAt: event.occurredAt,
    ...(typeof event.data.source === "string"
      ? { source: event.data.source }
      : {}),
    ...(typeof event.data.name === "string" ? { name: event.data.name } : {}),
  };

  try {
    await redis
      .multi()
      .lPush(PRODUCT_ACTIVITY_LIST_KEY, JSON.stringify(entry))
      .lTrim(PRODUCT_ACTIVITY_LIST_KEY, 0, ACTIVITY_LIMIT - 1)
      .expire(PRODUCT_ACTIVITY_LIST_KEY, ACTIVITY_TTL_SECONDS)
      .hIncrBy(PRODUCT_ACTIVITY_COUNTS_KEY, event.type, 1)
      .expire(PRODUCT_ACTIVITY_COUNTS_KEY, ACTIVITY_TTL_SECONDS)
      .exec();
  } catch (error) {
    console.error("Failed to record product activity in Redis:", error);
  }
}

export interface ProductActivityFeed {
  /** False when Redis is down, so the API can say so instead of lying. */
  available: boolean;
  recent: ProductActivityEntry[];
  /** Event type -> how many times it has been consumed, e.g. `{ "product.fetched": 12 }`. */
  counts: Record<string, number>;
}

export async function readProductActivity(): Promise<ProductActivityFeed> {
  const empty: ProductActivityFeed = {
    available: false,
    recent: [],
    counts: {},
  };

  if (!redis.isReady) return empty;

  try {
    const [entries, rawCounts] = await Promise.all([
      redis.lRange(PRODUCT_ACTIVITY_LIST_KEY, 0, ACTIVITY_LIMIT - 1),
      redis.hGetAll(PRODUCT_ACTIVITY_COUNTS_KEY),
    ]);

    const recent: ProductActivityEntry[] = [];

    for (const raw of entries) {
      try {
        recent.push(JSON.parse(raw) as ProductActivityEntry);
      } catch {
        // Skip a corrupted entry rather than failing the whole feed.
      }
    }

    const counts: Record<string, number> = {};

    for (const [type, value] of Object.entries(rawCounts)) {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        counts[type] = parsed;
      }
    }

    return { available: true, recent, counts };
  } catch (error) {
    console.error("Failed to read product activity from Redis:", error);
    return empty;
  }
}
