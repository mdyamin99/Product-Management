/**
 * An error whose HTTP status code is safe to surface to the client. Anything
 * thrown that is *not* an AppError is treated as an unexpected failure and
 * reported as a generic 500.
 */
export class AppError extends Error {
  /** Optional field-level messages, keyed by the offending input path. */
  public readonly details?: Record<string, string>;

  constructor(
    public readonly statusCode: number,
    message: string,
    details?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
    this.details = details;
  }
}
