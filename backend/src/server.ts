import app from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { redis, connectRedis } from "./config/redis.js";
import { connectKafka, onKafkaReady } from "./config/kafka.js";
import { connectRabbit, isRabbitReady } from "./config/rabbitmq.js";
import {
  startProductEventConsumer,
  stopKafka,
} from "./modules/events/kafka-events.js";
import {
  startAuthEventConsumer,
  stopAuthConsumer,
} from "./modules/events/auth-events.js";
import {
  startNotificationConsumer,
  stopRabbit,
} from "./modules/events/rabbitmq-events.js";
import { startAuthNotificationConsumer } from "./modules/events/rabbit-auth-events.js";

async function startServer(): Promise<void> {
  await prisma.$connect();

  try {
    await connectRedis();
    console.log("Redis connected");
  } catch (error) {
    console.error("Redis unavailable; continuing without cache:", error);
  }

  // Accept traffic before touching the brokers: when Kafka is down its own
  // connect retries can take a minute to exhaust, and /health must still be
  // able to report `kafka: false` while that happens.
  const server = app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`Backend listening on port ${env.PORT}`);
  });

  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("Shutting down server...");

    server.close(async () => {
      try {
        // Stop consumers before tearing down the shared connections.
        await stopAuthConsumer();
        await stopKafka();
        await stopRabbit();

        if (redis.isOpen) {
          await redis.quit();
        }

        await prisma.$disconnect();
        process.exitCode = 0;
      } catch (error) {
        console.error("Shutdown error:", error);
        process.exitCode = 1;
      }
    });
  }

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  // Consumers start through the ready hook rather than inline: if the broker
  // is not up yet, `connectKafka` keeps retrying in the background and the
  // listeners fire on the attempt that succeeds. Each consumer gets its own
  // guard so a failure in one cannot silence the other.
  onKafkaReady(async () => {
    await startProductEventConsumer().catch((error) => {
      console.error("Kafka product consumer failed to start:", error);
    });

    await startAuthEventConsumer().catch((error) => {
      console.error("Kafka auth consumer failed to start:", error);
    });

    console.log("Kafka connected; streaming product and auth events");
  });

  // Kafka and RabbitMQ come up independently of the HTTP server (and of
  // each other): a broker outage delays events, never the API itself.
  await Promise.all([
    connectKafka(),
    (async () => {
      await connectRabbit();

      // Registration works whether or not the broker answered: `consumeQueue`
      // keeps the handler and attaches it as soon as a connection
      // (re)establishes.
      await startNotificationConsumer().catch((error) => {
        console.error("RabbitMQ notification consumer failed to start:", error);
      });

      await startAuthNotificationConsumer().catch((error) => {
        console.error("RabbitMQ auth consumer failed to start:", error);
      });

      console.log(
        isRabbitReady()
          ? "RabbitMQ connected; consuming notification queues"
          : "RabbitMQ not reachable; consumers will attach on reconnect",
      );
    })(),
  ]);
}

startServer().catch(async (error) => {
  console.error("Failed to start backend:", error);

  await stopAuthConsumer().catch(() => undefined);
  await stopKafka().catch(() => undefined);
  await stopRabbit().catch(() => undefined);

  await prisma.$disconnect().catch(() => undefined);

  if (redis.isOpen) {
    await redis.quit().catch(() => undefined);
  }

  process.exitCode = 1;
});
