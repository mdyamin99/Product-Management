import type { RequestHandler, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/app-error.js";
import * as authService from "./auth.service.js";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.schema.js";

export const REFRESH_COOKIE = "refresh_token";

/**
 * The refresh token is deliberately kept in a cookie that JavaScript cannot
 * read: an XSS bug can steal the access token but not the ability to mint
 * new ones. The path is scoped to the auth endpoints so it is never attached
 * to ordinary API calls.
 */
function refreshCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    path: "/api/auth",
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

function setRefreshCookie(res: Response, token: string, maxAge: number): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(maxAge));
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

function readRefreshCookie(req: {
  cookies?: Record<string, unknown>;
}): string | null {
  const value = req.cookies?.[REFRESH_COOKIE];

  return typeof value === "string" && value.length > 0 ? value : null;
}

// POST /api/auth/register
export const register: RequestHandler = async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const session = await authService.register(input);

    setRefreshCookie(res, session.refreshToken, session.refreshMaxAge);

    res.status(201).json({
      success: true,
      message: "Account created. Welcome aboard!",
      data: {
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/login
export const login: RequestHandler = async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const session = await authService.login(input);

    setRefreshCookie(res, session.refreshToken, session.refreshMaxAge);

    res.status(200).json({
      success: true,
      message: "Signed in successfully",
      data: {
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/refresh
export const refresh: RequestHandler = async (req, res, next) => {
  try {
    const presented = readRefreshCookie(req);

    if (presented === null) {
      throw new AppError(401, "No active session. Please sign in again.");
    }

    const session = await authService.refresh(presented);

    setRefreshCookie(res, session.refreshToken, session.refreshMaxAge);

    res.status(200).json({
      success: true,
      message: "Session refreshed",
      data: {
        user: session.user,
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
      },
    });
  } catch (error) {
    // A rejected refresh means the session is gone, so drop the stale cookie
    // instead of letting the client retry with it forever. Transient failures
    // (e.g. the database blipping) keep the cookie so the user is not signed
    // out by an unrelated outage.
    if (error instanceof AppError && error.statusCode === 401) {
      clearRefreshCookie(res);
    }

    next(error);
  }
};

// POST /api/auth/logout
export const logout: RequestHandler = async (req, res) => {
  try {
    await authService.logout(readRefreshCookie(req));
  } catch (error) {
    // Signing out is idempotent: log the problem but always drop the cookie.
    console.error("Logout failed:", error);
  }

  clearRefreshCookie(res);

  res.status(200).json({
    success: true,
    message: "Signed out successfully",
  });
};

// GET /api/auth/me
export const me: RequestHandler = async (req, res, next) => {
  try {
    const auth = req.auth;

    if (!auth) {
      throw new AppError(401, "You must be signed in to do that.");
    }

    const user = await authService.getMe(auth.sub);

    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/forgot-password
export const forgotPassword: RequestHandler = async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);

    await authService.requestPasswordReset(email);

    // Deliberately the same message whether or not the address exists.
    res.status(200).json({
      success: true,
      message:
        "If an account exists for that address, a 6-digit verification code is on its way.",
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/reset-password
export const resetPassword: RequestHandler = async (req, res, next) => {
  try {
    const input = resetPasswordSchema.parse(req.body);

    await authService.resetPassword(input);

    res.status(200).json({
      success: true,
      message: "Your password has been updated. Please sign in.",
    });
  } catch (error) {
    next(error);
  }
};
