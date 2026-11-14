import { z } from "zod";

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    description: z.string().max(5000).optional(),
    price: z.number().finite().nonnegative(),
  })
  .strict();

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().max(5000).nullable().optional(),
    price: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const productIdSchema = z.coerce.number().int().positive();
