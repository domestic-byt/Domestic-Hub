import { describe, expect, it } from 'vitest';
import { ApiError, apiUrl } from './api';

describe('apiUrl', () => {
  it('prefixes the configured API base', () => {
    expect(apiUrl('/loads')).toMatch(/\/api\/loads$/);
  });

  it('keeps query strings intact', () => {
    expect(apiUrl('/loads?x=1')).toMatch(/\/api\/loads\?x=1$/);
  });
});

describe('ApiError', () => {
  it('carries the status code', () => {
    const err = new ApiError(409, 'Load is assigned, not open.');
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/not open/);
  });
});
