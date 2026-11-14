import { z } from "zod";

/**
 * Trimmed, lowercased and format-checked in one chain so the value stored in
 * the database is always the canonical form used for lookups.
 */
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid e-mail address")
  .max(255, "E-mail must be 255 characters or fewer");

const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be 128 characters or fewer")
  .refine((value) => /[a-z]/.test(value), {
    message: "Password must include a lowercase letter",
  })
  .refine((value) => /[A-Z]/.test(value), {
    message: "Password must include an uppercase letter",
  })
  .refine((value) => /[0-9]/.test(value), {
    message: "Password must include a number",
  });

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must be 100 characters or fewer"),
    email: emailField,
    password: passwordField,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const loginSchema = z
  .object({
    email: emailField,
    password: z.string().min(1, "Enter your password").max(128),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: emailField,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    email: emailField,
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code from your e-mail"),
    password: passwordField,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
