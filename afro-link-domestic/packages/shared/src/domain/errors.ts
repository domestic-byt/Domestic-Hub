export type DomainErrorCode = 'not_found' | 'conflict' | 'validation';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly issues: string[] = [message],
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
