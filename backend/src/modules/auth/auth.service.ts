import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, type User } from "@prisma/client";
import { env } from "../../config/env.js";
import {
  refreshCookieMaxAge,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../config/jwt.js";
import { sendPasswordResetCodeEmail } from "../../config/mailer.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/app-error.js";
import { publishAuthEvent } from "../events/auth-events.js";
import type {
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.schema.js";

const BCRYPT_ROUNDS = 12;

/**
 * How long a token that has just been rotated stays acceptable. Two tabs can
 * legitimately read the same cookie a millisecond apart; without this window
 * the loser would be mistaken for a replay and the whole session revoked.
 */
const ROTATION_GRACE_MS = 30_000;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface SessionResult {
  user: PublicUser;
  accessToken: string;
  /** Absolute lifetime of `accessToken`, in seconds. */
  expiresIn: number;
}

/** Shape the client receives alongside the tokens. */
export interface AuthSession extends SessionResult {
  refreshToken: string;
  refreshMaxAge: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

/**
 * Compared against when the e-mail is unknown so a missing account costs the
 * same wall-clock time as a wrong password, keeping response times from
 * revealing which addresses are registered.
 */
let dummyHash: string | null = null;

async function getDummyHash(): Promise<string> {
  if (dummyHash === null) {
    dummyHash = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
  }

  return dummyHash;
}

/**
 * Persist a refresh token and return it as a signed JWT. The database keeps
 * only its SHA-256, so a leaked database dump cannot be replayed as a session.
 */
async function createRefreshToken(userId: string, familyId: string) {
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + refreshCookieMaxAge());

  const token = signRefreshToken({ userId, tokenId, familyId });

  await prisma.refreshToken.create({
    data: {
      id: tokenId,
      tokenHash: sha256(token),
      familyId,
      userId,
      expiresAt,
    },
  });

  return token;
}

async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Housekeeping. Only *expired* rows are removed: a revoked-but-unexpired row
 * is still needed to recognise a replayed token for the rest of its lifetime.
 */
async function pruneTokens(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });
}

export async function register(input: RegisterInput): Promise<AuthSession> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    throw new AppError(409, "An account with that e-mail already exists.", {
      email: "This e-mail is already registered.",
    });
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  let user: User;

  try {
    user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        lastLoginAt: new Date(),
      },
    });
  } catch (error) {
    // Two registrations racing for the same e-mail both pass the pre-check.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(409, "An account with that e-mail already exists.", {
        email: "This e-mail is already registered.",
      });
    }

    throw error;
  }

  const refreshToken = await createRefreshToken(user.id, randomUUID());

  await publishAuthEvent("user.registered", {
    id: user.id,
    email: user.email,
    name: user.name,
  });

  return buildSession(user, refreshToken);
}

export async function login(input: LoginInput): Promise<AuthSession> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });

  // Always run a comparison so timing does not distinguish "no such user"
  // from "wrong password".
  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? (await getDummyHash()),
  );

  if (!user || !passwordMatches) {
    throw new AppError(401, "Incorrect e-mail or password.");
  }

  await pruneTokens(user.id);

  const refreshToken = await createRefreshToken(user.id, randomUUID());

  const lastLoginAt = new Date();

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt },
  });

  await publishAuthEvent("user.loggedin", {
    id: user.id,
    email: user.email,
    name: user.name,
  });

  return buildSession({ ...user, lastLoginAt }, refreshToken);
}

/**
 * A rotated token showing up again is either a second tab that read the
 * cookie just before the first one finished, or a replayed token. Inside a
 * short grace window we assume the former and mint a replacement; after it we
 * assume theft and tear down every token in the family.
 */
async function recoverFromRotation(row: {
  revokedAt: Date | null;
  replacedBy: string | null;
  userId: string;
  familyId: string;
}): Promise<string | null> {
  if (row.revokedAt === null || row.replacedBy === null) return null;
  if (Date.now() - row.revokedAt.getTime() > ROTATION_GRACE_MS) return null;

  return createRefreshToken(row.userId, row.familyId);
}

function buildSession(user: User, refreshToken: string): AuthSession {
  return {
    user: toPublicUser(user),
    accessToken: signAccessToken(user),
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    refreshToken,
    refreshMaxAge: refreshCookieMaxAge(),
  };
}

/**
 * Exchange a presented refresh token for a fresh pair, rotating it in the
 * process. Presenting a token that has already been rotated is treated as
 * theft — unless it happens inside the grace window — and revokes every
 * token in the family.
 */
export async function refresh(presented: string): Promise<AuthSession> {
  const payload = verifyRefreshToken(presented);

  const row = await prisma.refreshToken.findUnique({
    where: { id: payload.jti },
  });

  if (
    row === null ||
    row.userId !== payload.sub ||
    row.familyId !== payload.fam ||
    row.tokenHash !== sha256(presented)
  ) {
    throw new AppError(401, "Invalid session. Please sign in again.");
  }

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
  });

  if (user === null) {
    await revokeFamily(row.familyId);
    throw new AppError(401, "This account no longer exists.");
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    throw new AppError(401, "Your session has expired. Please sign in again.");
  }

  if (row.revokedAt !== null) {
    const recovery = await recoverFromRotation(row);

    if (recovery !== null) {
      return buildSession(user, recovery);
    }

    await revokeFamily(row.familyId);
    throw new AppError(401, "Your session was revoked. Please sign in again.");
  }

  const rotated = await rotate(row.id, row.userId, row.familyId);

  if (rotated !== null) {
    return buildSession(user, rotated);
  }

  // Another request claimed this row between our read and our write.
  const current = await prisma.refreshToken.findUnique({
    where: { id: row.id },
  });

  const recovery =
    current === null ? null : await recoverFromRotation(current);

  if (recovery !== null) {
    return buildSession(user, recovery);
  }

  await revokeFamily(row.familyId);
  throw new AppError(401, "Your session was revoked. Please sign in again.");
}

/**
 * Atomically claims the current row before minting its replacement. Two
 * concurrent refreshes with the same token therefore cannot both succeed:
 * the loser sees `count === 0` and the family is torn down as compromised.
 */
async function rotate(
  currentId: string,
  userId: string,
  familyId: string,
): Promise<string | null> {
  const nextId = randomUUID();
  const nextExpiresAt = new Date(Date.now() + refreshCookieMaxAge());
  const nextToken = signRefreshToken({ userId, tokenId: nextId, familyId });
  const nextHash = sha256(nextToken);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.refreshToken.updateMany({
      where: { id: currentId, revokedAt: null },
      data: { revokedAt: new Date(), replacedBy: nextId },
    });

    if (claimed.count === 0) {
      return null;
    }

    await tx.refreshToken.create({
      data: {
        id: nextId,
        tokenHash: nextHash,
        familyId,
        userId,
        expiresAt: nextExpiresAt,
      },
    });

    return nextToken;
  });
}

/**
 * Revoke the session the presented token belongs to. Each sign-in creates its
 * own family, so this ends that one device's session without touching the
 * others. Invalid tokens are a no-op, which keeps logout idempotent.
 */
export async function logout(presented: string | null): Promise<void> {
  if (presented === null) return;

  try {
    const payload = verifyRefreshToken(presented);

    const row = await prisma.refreshToken.findUnique({
      where: { id: payload.jti },
    });

    if (row !== null && row.tokenHash === sha256(presented)) {
      await revokeFamily(row.familyId);
    }
  } catch {
    // Already invalid or expired — there is nothing left to revoke.
  }
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (user === null) {
    throw new AppError(401, "This account no longer exists.");
  }

  return toPublicUser(user);
}

const RESET_TTL_MINUTES = 30;
const RESET_TTL_MS = RESET_TTL_MINUTES * 60 * 1000;
/** Wrong codes accepted per reset request before the code is burned. */
const RESET_CODE_MAX_ATTEMPTS = 5;

/**
 * Pepper for the HMAC that stores reset codes. Falls back to the refresh
 * secret so a deployment does not need another variable to be secure; the
 * dedicated pepper can still be set to keep the two concerns apart.
 */
function resetPepper(): string {
  return env.PASSWORD_RESET_PEPPER || env.JWT_REFRESH_SECRET;
}

/**
 * Only the digest is persisted, keyed by the owning account: a leaked
 * database dump cannot be replayed against another user, and the 6-digit
 * code itself never sits in clear text.
 */
function hashResetCode(userId: string, code: string): string {
  return createHmac("sha256", resetPepper())
    .update(`${userId}:${code}`)
    .digest("hex");
}

/** Length-checked before `timingSafeEqual`, which throws on a mismatch. */
function resetCodesMatch(stored: string, candidate: string): boolean {
  const left = Buffer.from(stored, "utf8");
  const right = Buffer.from(candidate, "utf8");

  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Start a password reset by e-mailing a 6-digit code. The response is
 * identical whether or not the address is registered, so the endpoint cannot
 * be used to enumerate accounts; delivery failures are logged rather than
 * reported for the same reason.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });

  if (user === null) return;

  // Supersede anything still outstanding so only the newest code works.
  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id },
  });

  const code = randomInt(100_000, 1_000_000).toString();

  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashResetCode(user.id, code),
      userId: user.id,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
      attempts: 0,
    },
  });

  try {
    await sendPasswordResetCodeEmail({
      to: user.email,
      name: user.name,
      code,
      expiresInMinutes: RESET_TTL_MINUTES,
    });
  } catch (error) {
    console.error(`Password reset e-mail failed for ${user.email}:`, error);
  }
}

/**
 * Apply a new password from the e-mailed code, consuming the code and
 * revoking every existing session so a stolen refresh cookie stops working
 * the moment the account owner reclaims it.
 *
 * The attempts column caps guessing at five wrong codes — a 6-digit space
 * is far too small to survive an uncapped online brute force — and the
 * per-IP rate limit on the endpoint bounds how often a script can try at
 * all.
 */
export async function resetPassword(
  input: ResetPasswordInput,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  const record =
    user === null
      ? null
      : await prisma.passwordResetToken.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
        });

  if (
    record === null ||
    record.usedAt !== null ||
    record.expiresAt.getTime() <= Date.now()
  ) {
    throw new AppError(
      400,
      "This code is invalid or has expired. Request a new one.",
    );
  }

  if (record.attempts >= RESET_CODE_MAX_ATTEMPTS) {
    // Burn the code so a guessing script cannot keep chipping away at it.
    await prisma.passwordResetToken.deleteMany({
      where: { id: record.id, usedAt: null },
    });

    throw new AppError(400, "Too many incorrect attempts. Request a new code.");
  }

  if (!resetCodesMatch(record.tokenHash, hashResetCode(record.userId, input.code))) {
    const counted = await prisma.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { attempts: { increment: 1 } },
    });

    if (counted.count === 0) {
      throw new AppError(
        400,
        "This code is invalid or has expired. Request a new one.",
      );
    }

    const remaining = Math.max(
      0,
      RESET_CODE_MAX_ATTEMPTS - record.attempts - 1,
    );

    throw new AppError(
      400,
      remaining === 0
        ? "Too many incorrect attempts. Request a new code."
        : `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
    );
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    // Claim the code first: two concurrent submissions must not both win.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new AppError(400, "This code has already been used.");
    }

    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });

    await tx.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}
