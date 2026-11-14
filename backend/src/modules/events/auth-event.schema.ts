import { z } from "zod";

export const authEventTypeSchema = z.enum([
  "user.registered",
  "user.loggedin",
]);

export const authEventSchema = z.object({
  eventId: z.string().uuid(),
  type: authEventTypeSchema,
  occurredAt: z.string(),
  userId: z.string().min(1),
  data: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(100),
  }),
});

export type AuthEventType = z.infer<typeof authEventTypeSchema>;
export type AuthEvent = z.infer<typeof authEventSchema>;
