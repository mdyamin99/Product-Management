import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { isKafkaReady, kafkaAuthConsumer, kafkaProducer } from "../../config/kafka.js";
import { publishToRabbit } from "../../config/rabbitmq.js";
import {
  authEventSchema,
  type AuthEvent,
  type AuthEventType,
} from "./auth-event.schema.js";
import { deliverAuthNotification } from "./auth-notifications.js";
import { commitOffset } from "./kafka-events.js";

interface AuthEventData {
  id: string;
  email: string;
  name: string;
}

/**
 * Publish an account event to the auth topic.
 *
 * The welcome e-mail must still arrive when the brokers are down, so a failed
 * publish falls back to delivering the notification directly. The fallback is
 * intentionally fire-and-forget: signing in must never block on SMTP.
 */
export async function publishAuthEvent(
  type: AuthEventType,
  data: AuthEventData,
): Promise<void> {
  const event: AuthEvent = {
    eventId: randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    userId: data.id,
    data: { email: data.email, name: data.name },
  };

  if (!isKafkaReady()) {
    console.warn(`Kafka not connected; delivering ${type} notification directly`);
    void deliverDirectly(event);
    return;
  }

  try {
    await kafkaProducer.send({
      topic: env.KAFKA_AUTH_TOPIC,
      acks: -1,
      messages: [
        {
          key: event.userId,
          value: JSON.stringify(event),
          headers: { "event-type": type },
        },
      ],
    });
  } catch (error) {
    console.error(`Failed to publish ${type} event to Kafka:`, error);
    void deliverDirectly(event);
  }
}

async function deliverDirectly(event: AuthEvent): Promise<void> {
  try {
    await deliverAuthNotification(event);
  } catch (error) {
    console.error(
      `Direct delivery of ${event.type} notification failed for ${event.data.email}:`,
      error,
    );
  }
}

/**
 * Consume account events from Kafka and forward them to the RabbitMQ auth
 * exchange, where the notification queue turns them into e-mails. Offsets are
 * committed manually after the forward attempt so events are not lost on
 * crashes (at-least-once delivery).
 *
 * `fromBeginning` is false on purpose: replaying the whole topic on every
 * restart would re-send welcome e-mails to everyone who ever signed in.
 */
export async function startAuthEventConsumer(): Promise<void> {
  await kafkaAuthConsumer.subscribe({
    topic: env.KAFKA_AUTH_TOPIC,
    fromBeginning: false,
  });

  await kafkaAuthConsumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value?.toString();

      if (!raw) {
        return;
      }

      let event: AuthEvent;

      try {
        event = authEventSchema.parse(JSON.parse(raw));
      } catch (error) {
        // Commit poison messages so they cannot block the partition.
        console.error("Skipping malformed auth event from Kafka:", error);
        await commitOffset(kafkaAuthConsumer, topic, partition, message.offset);
        return;
      }

      const forwarded = await publishToRabbit(
        env.RABBITMQ_AUTH_EXCHANGE,
        event.type,
        event,
      );

      if (!forwarded) {
        // RabbitMQ is down: send the e-mail here rather than drop it.
        console.warn(
          `RabbitMQ unavailable; delivering ${event.type} ${event.eventId} directly`,
        );
        await deliverDirectly(event);
      }

      await commitOffset(kafkaAuthConsumer, topic, partition, message.offset);
    },
  });
}

export async function stopAuthConsumer(): Promise<void> {
  await kafkaAuthConsumer.stop().catch((error) => {
    console.error("Kafka auth consumer stop failed:", error);
  });
}
