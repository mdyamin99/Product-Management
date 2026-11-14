import { Router } from "express";
import { env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { rateLimit } from "../../middleware/rate-limit.middleware.js";
import * as authController from "./auth.controller.js";

const router = Router();

// Signup is deliberately stricter than sign-in: a bot creating throwaway
// accounts is far more damaging than a user who mistypes their password.
const registerLimiter = rateLimit({
  keyPrefix: "auth:register",
  max: env.REGISTER_RATE_LIMIT,
  windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
  message: "Too many accounts created from this address. Please try again later.",
});

const loginLimiter = rateLimit({
  keyPrefix: "auth:login",
  max: env.LOGIN_RATE_LIMIT,
  windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
  message: "Too many sign-in attempts. Please wait a few minutes and try again.",
});

// A healthy client refreshes roughly once per access-token lifetime (15 min),
// so this ceiling only ever trips for scripted abuse of a stolen cookie.
const refreshLimiter = rateLimit({
  keyPrefix: "auth:refresh",
  max: 30,
  windowSeconds: 60,
  message: "Too many session requests. Please reload the page.",
});

router.post("/register", registerLimiter, authController.register);
router.post("/login", loginLimiter, authController.login);
router.post("/refresh", refreshLimiter, authController.refresh);
router.post("/logout", authController.logout);
router.get("/me", requireAuth, authController.me);

// Reset links are one-time and expire, so these limits only need to stop an
// inbox-flooding or token-guessing script.
const forgotPasswordLimiter = rateLimit({
  keyPrefix: "auth:forgot",
  max: 5,
  windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
  message: "Too many reset requests from this address. Please try again later.",
});

const resetPasswordLimiter = rateLimit({
  keyPrefix: "auth:reset",
  max: 15,
  windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
  message: "Too many reset attempts. Please wait a few minutes and try again.",
});

router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  authController.forgotPassword,
);
router.post(
  "/reset-password",
  resetPasswordLimiter,
  authController.resetPassword,
);

export default router;
