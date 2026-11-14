import { env } from "../../config/env.js";
import { closeRabbit, consumeQueue } from "../../config/rabbitmq.js";
import { productEventSchema } from "./product-event.schema.js";
import { recordProductActivity } from "./product-activity.js";

/**
 * Consume product events from the RabbitMQ work queue. Each event that made
 * the Kafka -> RabbitMQ journey is written to the Redis-backed activity feed
 * (`GET /api/products/activity`), which is what the dashboard's Activity tab
 * renders — the consumer's output is observable, not just logged.
 */
export async function startNotificationConsumer(): Promise<void> {
  await consumeQueue(env.RABBITMQ_QUEUE, async (content) => {
    const event = productEventSchema.parse(JSON.parse(content.toString()));

    await recordProductActivity(event);

    const target =
      event.productId !== undefined
        ? `product ${event.productId}`
        : `product list (${String(event.data.count ?? "?")} rows)`;

    console.log(
      `[notifications] ${event.type} for ${target} recorded (event ${event.eventId})`,
    );
  });
}

export async function stopRabbit(): Promise<void> {
  await closeRabbit();
}
