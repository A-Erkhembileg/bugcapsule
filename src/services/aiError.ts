export class AIDiagnosticError extends Error {
  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AIDiagnosticError';
  }
}
