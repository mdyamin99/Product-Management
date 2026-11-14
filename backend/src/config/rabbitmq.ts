import amqp from "amqplib";
import { env } from "./env.js";

let connection: amqp.ChannelModel | null = null;
let channel: amqp.Channel | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let closing = false;

export type RabbitMessageHandler = (
  content: Buffer,
  message: amqp.ConsumeMessage,
) => Promise<void>;

interface RegisteredConsumer {
  queue: string;
  handler: RabbitMessageHandler;
  /** Whether the *current* channel has an active `consume` for this queue. */
  started: boolean;
}

/**
 * Every consumer ever registered with `consumeQueue`. A dropped connection
 * tears down all server-side consumers with it, so this registry is replayed
 * against each freshly opened channel — without it a reconnect would leave
 * the process connected but silently consuming nothing.
 */
const consumers: RegisteredConsumer[] = [];

export function isRabbitReady(): boolean {
  return channel !== null;
}

function scheduleReconnect(): void {
  if (closing || reconnectTimer !== null) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectRabbit();
  }, 5000);

  // Do not keep the process alive just to retry the connection.
  reconnectTimer.unref();
}

/** A new channel starts with no consumers; the old ones died with the old one. */
function resetConsumerState(): void {
  for (const consumer of consumers) {
    consumer.started = false;
  }
}

async function startConsumer(consumer: RegisteredConsumer): Promise<void> {
  if (channel === null || consumer.started) return;

  // Set before the await so two racing callers cannot consume twice.
  consumer.started = true;

  try {
    await channel.consume(
      consumer.queue,
      (message) => {
        if (!message) return;

        void (async () => {
          try {
            await consumer.handler(message.content, message);
            safeAck(message, "ack");
          } catch (error) {
            // Drop malformed or permanently failing messages instead of
            // requeueing them into an infinite redelivery loop.
            console.error(
              `RabbitMQ handler failed for queue "${consumer.queue}":`,
              error,
            );
            safeAck(message, "nack");
          }
        })();
      },
      { noAck: false },
    );
  } catch (error) {
    consumer.started = false;
    throw error;
  }
}

/**
 * Ack/nack against the channel that is open *now*. A message that outlived
 * its channel cannot be acknowledged — the broker requeues it on its own —
 * so a rejection here is logged, not propagated into the handler chain.
 */
function safeAck(
  message: amqp.ConsumeMessage,
  operation: "ack" | "nack",
): void {
  try {
    if (operation === "ack") {
      channel?.ack(message);
    } else {
      channel?.nack(message, false, false);
    }
  } catch (error) {
    console.error(`RabbitMQ ${operation} failed (message will be redelivered):`, error);
  }
}

async function attachConsumersToChannel(): Promise<void> {
  if (consumers.length > 0) {
    console.log(
      `RabbitMQ re-subscribing ${consumers.length} consumer(s) after (re)connect`,
    );
  }

  for (const consumer of consumers) {
    await startConsumer(consumer);
  }
}

export async function connectRabbit(): Promise<boolean> {
  if (closing) return false;

  try {
    connection = await amqp.connect(env.RABBITMQ_URL);

    connection.on("error", (error) => {
      console.error("RabbitMQ connection error:", error.message);
    });

    connection.on("close", () => {
      connection = null;
      channel = null;
      resetConsumerState();

      if (!closing) {
        console.error("RabbitMQ connection closed; reconnecting in 5s...");
        scheduleReconnect();
      }
    });

    channel = await connection.createChannel();

    channel.on("error", (error) => {
      console.error("RabbitMQ channel error:", error.message);
    });

    channel.on("close", () => {
      channel = null;
      resetConsumerState();
    });

    // Topology: a durable topic exchange fans product events out to work
    // queues. "product.#" matches product.created/updated/deleted/fetched.
    await channel.assertExchange(env.RABBITMQ_EXCHANGE, "topic", {
      durable: true,
    });
    await channel.assertQueue(env.RABBITMQ_QUEUE, { durable: true });
    await channel.bindQueue(
      env.RABBITMQ_QUEUE,
      env.RABBITMQ_EXCHANGE,
      "product.#",
    );

    // Account events ride a second topic exchange so auth notifications can
    // be scaled, monitored and replayed independently of product traffic.
    // "user.#" matches user.registered / user.loggedin.
    await channel.assertExchange(env.RABBITMQ_AUTH_EXCHANGE, "topic", {
      durable: true,
    });
    await channel.assertQueue(env.RABBITMQ_AUTH_QUEUE, { durable: true });
    await channel.bindQueue(
      env.RABBITMQ_AUTH_QUEUE,
      env.RABBITMQ_AUTH_EXCHANGE,
      "user.#",
    );

    await channel.prefetch(10);

    // Re-subscribe everything registered before or during earlier attempts,
    // including consumers registered while the broker was unreachable.
    await attachConsumersToChannel();

    return true;
  } catch (error) {
    console.error("RabbitMQ unavailable; notification queue disabled:", error);
    connection = null;
    channel = null;
    resetConsumerState();
    scheduleReconnect();
    return false;
  }
}

export async function publishToRabbit(
  exchange: string,
  routingKey: string,
  message: unknown,
): Promise<boolean> {
  if (!channel) return false;

  try {
    channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      contentType: "application/json",
      timestamp: Date.now(),
    });

    return true;
  } catch (error) {
    console.error("RabbitMQ publish failed:", error);
    return false;
  }
}

/**
 * Register a queue handler. Safe to call while RabbitMQ is down: the
 * handler is kept in the registry and starts consuming as soon as a
 * connection (re)establishes, so callers never need to retry themselves.
 */
export async function consumeQueue(
  queue: string,
  handler: RabbitMessageHandler,
): Promise<void> {
  const existing = consumers.find((consumer) => consumer.queue === queue);

  if (existing !== undefined) {
    // Re-registration with the same queue swaps in the latest handler.
    existing.handler = handler;

    if (!existing.started) {
      await startConsumer(existing);
    }

    return;
  }

  const consumer: RegisteredConsumer = { queue, handler, started: false };
  consumers.push(consumer);

  await startConsumer(consumer);
}

export async function closeRabbit(): Promise<void> {
  closing = true;

  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    await channel?.close();
  } catch (error) {
    console.error("RabbitMQ channel close failed:", error);
  } finally {
    channel = null;
    resetConsumerState();
  }

  try {
    await connection?.close();
  } catch (error) {
    console.error("RabbitMQ connection close failed:", error);
  } finally {
    connection = null;
  }
}
