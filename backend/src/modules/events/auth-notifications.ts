import { sendWelcomeBackEmail, sendWelcomeEmail } from "../../config/mailer.js";
import type { AuthEvent } from "./auth-event.schema.js";

/**
 * Single place where auth events turn into e-mails. Shared by the RabbitMQ
 * consumer (the happy path) and by the Kafka forwarder (used when RabbitMQ is
 * down) so the same message is never handled in two different ways.
 */
export async function deliverAuthNotification(event: AuthEvent): Promise<void> {
  const { email, name } = event.data;

  switch (event.type) {
    case "user.registered":
      await sendWelcomeEmail({ to: email, name });
      return;

    case "user.loggedin":
      await sendWelcomeBackEmail({ to: email, name, occurredAt: event.occurredAt });
      return;
  }
}
