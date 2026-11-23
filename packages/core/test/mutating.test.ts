import { describe, expect, it } from 'vitest';
import { isMutatingRequest } from '../src/safety/policy.ts';

describe('isMutatingRequest: what a plain click must not send without an OK', () => {
  it('stops data-changing requests from scripts and forms', () => {
    expect(isMutatingRequest({ method: 'POST', resourceType: 'fetch', url: 'https://api.example.com/v1/items' })).toBe(true);
    expect(isMutatingRequest({ method: 'DELETE', resourceType: 'fetch', url: 'https://example.com/item/1' })).toBe(true);
    expect(isMutatingRequest({ method: 'PATCH', resourceType: 'xhr', url: 'https://example.com/me' })).toBe(true);
    expect(isMutatingRequest({ method: 'POST', resourceType: 'document', url: 'https://example.com/form' })).toBe(true);
  });

  it('lets reads, beacons and tracking through', () => {
    expect(isMutatingRequest({ method: 'GET', resourceType: 'fetch', url: 'https://api.example.com/v1/items' })).toBe(false);
    expect(isMutatingRequest({ method: 'POST', resourceType: 'ping', url: 'https://example.com/beacon' })).toBe(false);
    expect(isMutatingRequest({ method: 'POST', resourceType: 'xhr', url: 'https://www.google-analytics.com/g/collect' })).toBe(false);
    expect(isMutatingRequest({ method: 'POST', resourceType: 'fetch', url: 'https://o1.ingest.sentry.io/api/1/envelope' })).toBe(false);
    expect(isMutatingRequest({ method: 'POST', resourceType: 'fetch', url: 'data:text/plain,hi' })).toBe(false);
  });
});
