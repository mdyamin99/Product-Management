import { z } from "zod";

export const productEventTypeSchema = z.enum([
  "product.created",
  "product.updated",
  "product.deleted",
  "product.fetched",
]);

export const productEventSchema = z.object({
  eventId: z.string().uuid(),
  type: productEventTypeSchema,
  occurredAt: z.string(),
  /**
   * Omitted for aggregate events such as a list fetch, which describe the
   * catalogue as a whole rather than a single row.
   */
  productId: z.number().int().positive().optional(),
  data: z.record(z.string(), z.unknown()),
});

export type ProductEventType = z.infer<typeof productEventTypeSchema>;
export type ProductEvent = z.infer<typeof productEventSchema>;
