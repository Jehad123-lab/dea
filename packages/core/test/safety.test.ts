import { describe, expect, it } from 'vitest';
import { decide, looksLikeSubmit } from '../src/safety/policy.ts';

describe('permission modes', () => {
  it('lets every mode look and scroll without asking', () => {
    for (const m of ['restricted', 'supervised', 'delegated'] as const) {
      expect(decide(m, 'read')).toBe('allow');
      expect(decide(m, 'navigate')).toBe('allow');
    }
  });
  it('never submits without asking', () => {
    expect(decide('restricted', 'submit')).toBe('deny');
    expect(decide('supervised', 'submit')).toBe('ask');
    expect(decide('delegated', 'submit')).toBe('ask');
  });
  it('keeps restricted read-only', () => {
    expect(decide('restricted', 'interact')).toBe('deny');
    expect(decide('restricted', 'upload')).toBe('deny');
  });
  it('spots submit-like targets', () => {
    expect(looksLikeSubmit({ type: 'submit' })).toBe(true);
    expect(looksLikeSubmit({ role: 'button', name: 'Place order' })).toBe(true);
    expect(looksLikeSubmit({ role: 'button', name: 'Next slide' })).toBe(false);
  });
});
