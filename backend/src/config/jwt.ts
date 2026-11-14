import jwt from "jsonwebtoken";
import { env } from "./env.js";
import { AppError } from "../lib/app-error.js";

const ISSUER = "product-management-api";
const AUDIENCE = "product-management-frontend";

export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  email: string;
  name: string;
  typ: "access";
}

export interface RefreshTokenPayload {
  /** User id. */
  sub: string;
  /** RefreshToken row this token maps to. */
  jti: string;
  /** Rotation family, so a whole session can be revoked at once. */
  fam: string;
  typ: "refresh";
}

function sign(
  payload: AccessTokenPayload | RefreshTokenPayload,
  secret: string,
  expiresIn: number,
): string {
  return jwt.sign(payload, secret, {
    expiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

function verify<T>(token: string, secret: string): T {
  try {
    return jwt.verify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as T;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(401, "Your session has expired. Please sign in again.");
    }

    throw new AppError(401, "Invalid authentication token.");
  }
}

export function signAccessToken(user: {
  id: string;
  email: string;
  name: string;
}): string {
  return sign(
    { sub: user.id, email: user.email, name: user.name, typ: "access" },
    env.JWT_ACCESS_SECRET,
    env.JWT_ACCESS_TTL_SECONDS,
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = verify<AccessTokenPayload>(token, env.JWT_ACCESS_SECRET);

  if (payload.typ !== "access") {
    throw new AppError(401, "Invalid authentication token.");
  }

  return payload;
}

export function signRefreshToken(params: {
  userId: string;
  tokenId: string;
  familyId: string;
}): string {
  return sign(
    { sub: params.userId, jti: params.tokenId, fam: params.familyId, typ: "refresh" },
    env.JWT_REFRESH_SECRET,
    env.JWT_REFRESH_TTL_SECONDS,
  );
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = verify<RefreshTokenPayload>(token, env.JWT_REFRESH_SECRET);

  if (payload.typ !== "refresh" || !payload.jti || !payload.fam) {
    throw new AppError(401, "Invalid authentication token.");
  }

  return payload;
}

/** Lifetime of the refresh cookie, in milliseconds. */
export function refreshCookieMaxAge(): number {
  return env.JWT_REFRESH_TTL_SECONDS * 1000;
}
