import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../lib/app-error.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      ...(error.details ? { errors: error.details } : {}),
    });
    return;
  }

  // Unique constraint violation (e.g. a racing registration for one e-mail).
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    res.status(409).json({
      success: false,
      message: "That record already exists.",
    });
    return;
  }

  // body-parser rejects oversized or malformed JSON with a 4xx status; report
  // it as such instead of leaking it as an internal server error.
  const bodyStatus = (error as { status?: unknown; statusCode?: unknown });
  const status =
    typeof bodyStatus.status === "number"
      ? bodyStatus.status
      : typeof bodyStatus.statusCode === "number"
        ? bodyStatus.statusCode
        : undefined;

  if (status !== undefined && status >= 400 && status < 500) {
    res.status(status).json({
      success: false,
      message: "Invalid request body",
    });
    return;
  }

  console.error(error);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};
