import type { RequestHandler } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "../config/jwt.js";
import { AppError } from "../lib/app-error.js";

declare module "express-serve-static-core" {
  interface Request {
    /** Populated by `requireAuth` once the bearer token has been verified. */
    auth?: AccessTokenPayload;
  }
}

function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const [scheme, token, ...rest] = header.split(" ");

  if (scheme !== "Bearer" || rest.length > 0) return null;

  return token && token.length > 0 ? token : null;
}

/** Rejects the request unless a valid `Authorization: Bearer <token>` is present. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = readBearerToken(req.headers.authorization);

  if (token === null) {
    next(new AppError(401, "You must be signed in to do that."));
    return;
  }

  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
};
