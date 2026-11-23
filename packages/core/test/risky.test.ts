import { describe, expect, it } from 'vitest';
import { riskyUrl } from '../src/safety/policy.ts';

describe('riskyUrl: links that change something just by being opened', () => {
  it('asks for logout, delete, unsubscribe and cancel links', () => {
    expect(riskyUrl('https://example.com/logout')).toBe(true);
    expect(riskyUrl('https://example.com/sign-out')).toBe(true);
    expect(riskyUrl('https://example.com/account/delete/')).toBe(true);
    expect(riskyUrl('https://example.com/cancel-subscription')).toBe(true);
    expect(riskyUrl('https://example.com/?action=unsubscribe&id=3')).toBe(true);
  });

  it('leaves ordinary pages alone', () => {
    expect(riskyUrl('https://example.com/products')).toBe(false);
    expect(riskyUrl('https://example.com/blog/how-to-delete-files')).toBe(false);
    expect(riskyUrl('javascript:alert(1)')).toBe(false);
  });
});
