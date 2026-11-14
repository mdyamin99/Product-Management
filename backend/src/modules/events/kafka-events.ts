import { randomUUID } from "node:crypto";
import type { Consumer } from "kafkajs";
import { env } from "../../config/env.js";
import {
  disconnectKafka,
  isKafkaReady,
  kafkaConsumer,
  kafkaProducer,
} from "../../config/kafka.js";
import { publishToRabbit } from "../../config/rabbitmq.js";
import {
  productEventSchema,
  type ProductEvent,
  type ProductEventType,
} from "./product-event.schema.js";

/**
 * Publish a product lifecycle event to the Kafka topic. Fire-and-forget:
 * a broker outage must never fail the API request that triggered it.
 *
 * `id` is optional because aggregate events (a list fetch) span many rows
 * and carry no single product id.
 */
export async function publishProductEvent(
  type: ProductEventType,
  data: { id?: number } & Record<string, unknown>,
): Promise<void> {
  if (!isKafkaReady()) {
    console.warn(`Kafka not connected; dropping ${type} event`);
    return;
  }

  const event: ProductEvent = {
    eventId: randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    ...(data.id === undefined ? {} : { productId: data.id }),
    data,
  };

  try {
    await kafkaProducer.send({
      topic: env.KAFKA_TOPIC,
      acks: -1,
      messages: [
        {
          key: String(data.id),
          value: JSON.stringify(event),
          headers: { "event-type": type },
        },
      ],
    });
  } catch (error) {
    console.error(`Failed to publish ${type} event to Kafka:`, error);
  }
}

/**
 * Commit the next offset on the given consumer so the message is not
 * redelivered after a restart. Offsets are per consumer group, so the caller
 * must pass the consumer that actually read the message.
 */
export async function commitOffset(
  consumer: Consumer,
  topic: string,
  partition: number,
  offset: string,
): Promise<void> {
  await consumer.commitOffsets([
    { topic, partition, offset: (BigInt(offset) + 1n).toString() },
  ]);
}

/**
 * Consume product events from Kafka and forward each one to the RabbitMQ
 * topic exchange, where work queues (e.g. notifications) pick them up.
 * Offsets are committed manually after the forward attempt so events are
 * not lost on crashes (at-least-once delivery).
 */
export async function startProductEventConsumer(): Promise<void> {
  await kafkaConsumer.subscribe({
    topic: env.KAFKA_TOPIC,
    fromBeginning: true,
  });

  await kafkaConsumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value?.toString();

      if (!raw) {
        return;
      }

      let event: ProductEvent;

      try {
        event = productEventSchema.parse(JSON.parse(raw));
      } catch (error) {
        // Commit poison messages so they cannot block the partition.
        console.error("Skipping malformed product event from Kafka:", error);
        await commitOffset(kafkaConsumer, topic, partition, message.offset);
        return;
      }

      const forwarded = await publishToRabbit(
        env.RABBITMQ_EXCHANGE,
        event.type,
        event,
      );

      if (!forwarded) {
        console.warn(
          `RabbitMQ unavailable; ${event.type} event ${event.eventId} was not forwarded`,
        );
      }

      await commitOffset(kafkaConsumer, topic, partition, message.offset);
    },
  });
}

export async function stopKafka(): Promise<void> {
  await kafkaConsumer.stop().catch((error) => {
    console.error("Kafka consumer stop failed:", error);
  });

  await disconnectKafka();
}
