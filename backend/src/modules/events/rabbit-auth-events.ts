import { env } from "../../config/env.js";
import { consumeQueue } from "../../config/rabbitmq.js";
import { authEventSchema } from "./auth-event.schema.js";
import { deliverAuthNotification } from "./auth-notifications.js";

/**
 * Consume account events from RabbitMQ and turn them into e-mails via
 * Nodemailer. This is the step that actually sends the welcome message a user
 * triggers by signing in.
 */
export async function startAuthNotificationConsumer(): Promise<void> {
  await consumeQueue(env.RABBITMQ_AUTH_QUEUE, async (content) => {
    const event = authEventSchema.parse(JSON.parse(content.toString()));

    await deliverAuthNotification(event);

    console.log(
      `[notifications] ${event.type} welcome message sent to ${event.data.email} (event ${event.eventId})`,
    );
  });
}
