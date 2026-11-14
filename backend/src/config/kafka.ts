import { Kafka, logLevel, type Consumer, type Producer } from "kafkajs";
import { env } from "./env.js";

const kafka = new Kafka({
  clientId: "product-management-backend",
  brokers: env.KAFKA_BROKERS,
  logLevel: logLevel.WARN,
  retry: { retries: 10 },
});

export const kafkaProducer: Producer = kafka.producer({
  allowAutoTopicCreation: true,
});

export const kafkaConsumer: Consumer = kafka.consumer({
  groupId: env.KAFKA_CONSUMER_GROUP,
});

/** Separate group so auth notifications keep flowing if product events stall. */
export const kafkaAuthConsumer: Consumer = kafka.consumer({
  groupId: env.KAFKA_AUTH_CONSUMER_GROUP,
});

const admin = kafka.admin();

let kafkaReady = false;
let closing = false;
let retryTimer: NodeJS.Timeout | null = null;
let readyListenersNotified = false;

type KafkaReadyListener = () => void | Promise<void>;

/**
 * Listeners run once, the first time Kafka becomes reachable — including
 * when that happens long after boot because the broker was slow to start.
 * Registering consumers here means an initial connection failure no longer
 * leaves the process running without them forever.
 */
const readyListeners: KafkaReadyListener[] = [];

export function onKafkaReady(listener: KafkaReadyListener): void {
  readyListeners.push(listener);
}

export function isKafkaReady(): boolean {
  return kafkaReady;
}

async function notifyReadyListeners(): Promise<void> {
  if (readyListenersNotified) return;
  readyListenersNotified = true;

  for (const listener of readyListeners) {
    try {
      await listener();
    } catch (error) {
      console.error("Kafka ready listener failed:", error);
    }
  }
}

/**
 * Consumers fail on subscribe when the topic has never been created, so
 * make sure they exist before anything tries to use them.
 */
async function ensureTopicsExist(): Promise<void> {
  const required = [env.KAFKA_TOPIC, env.KAFKA_AUTH_TOPIC];

  try {
    await admin.connect();

    const topics = await admin.listTopics();
    const missing = required.filter((topic) => !topics.includes(topic));

    if (missing.length === 0) return;

    await admin.createTopics({
      topics: missing.map((topic) => ({
        topic,
        numPartitions: 3,
        replicationFactor: 1,
      })),
    });

    for (const topic of missing) {
      console.log(`Kafka topic "${topic}" created`);
    }
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

async function disconnectAll(): Promise<void> {
  kafkaReady = false;

  await kafkaProducer.disconnect().catch((error) => {
    console.error("Kafka producer disconnect failed:", error);
  });

  await kafkaConsumer.disconnect().catch((error) => {
    console.error("Kafka consumer disconnect failed:", error);
  });

  await kafkaAuthConsumer.disconnect().catch((error) => {
    console.error("Kafka auth consumer disconnect failed:", error);
  });
}

async function tryConnectKafka(): Promise<boolean> {
  try {
    await kafkaProducer.connect();
    await ensureTopicsExist();
    await kafkaConsumer.connect();
    await kafkaAuthConsumer.connect();
    kafkaReady = true;

    await notifyReadyListeners();

    return true;
  } catch (error) {
    console.error(
      "Kafka unavailable; product and auth events will not be streamed:",
      error,
    );
    await disconnectAll();
    return false;
  }
}

function scheduleRetry(): void {
  if (closing || retryTimer !== null) return;

  retryTimer = setTimeout(() => {
    retryTimer = null;

    void (async () => {
      if (closing) return;

      if (await tryConnectKafka()) {
        console.log("Kafka connected after retrying; event streaming resumed");
        return;
      }

      scheduleRetry();
    })();
  }, 5000);

  // Do not keep the process alive just to retry the connection.
  retryTimer.unref();
}

/**
 * One attempt now; on failure the connection keeps retrying in the
 * background until it succeeds (or the process shuts down), and consumers
 * start through `onKafkaReady` whenever that happens.
 */
export async function connectKafka(): Promise<boolean> {
  if (await tryConnectKafka()) return true;

  console.error("Kafka not reachable; retrying every 5s in the background...");
  scheduleRetry();
  return false;
}

export async function disconnectKafka(): Promise<void> {
  closing = true;

  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  await disconnectAll();
}
