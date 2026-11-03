import { describe, expect, it } from 'vitest';
import { REDACTED, redactBody, redactText, redactUrl, stripHar } from '../src/evidence/secrets.ts';

const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('secret stripping', () => {
  it('strips cookies, auth headers and tokens from a HAR', () => {
    const har = {
      log: {
        entries: [
          {
            request: {
              url: `https://api.example.com/v1/me?access_token=abc123&page=2&X-Amz-Signature=deadbeef`,
              headers: [
                { name: 'Authorization', value: `Bearer ${jwt}` },
                { name: 'Cookie', value: 'session=s3cr3t; theme=dark' },
                { name: 'X-API-Key', value: 'k-123456' },
                { name: 'x-session-id', value: 'sess-999' },
                { name: ':authority', value: 'api.example.com' },
                { name: 'Accept', value: 'application/json' },
                { name: 'User-Agent', value: 'Mozilla/5.0' },
              ],
              cookies: [{ name: 'session', value: 's3cr3t' }],
              queryString: [
                { name: 'access_token', value: 'abc123' },
                { name: 'page', value: '2' },
              ],
              postData: { mimeType: 'application/json', text: JSON.stringify({ email: 'a@b.c', password: 'hunter2', nested: { refreshToken: 'r-1' } }) },
            },
            response: {
              headers: [
                { name: 'Set-Cookie', value: 'session=s3cr3t; HttpOnly' },
                { name: 'Content-Type', value: 'application/json' },
                { name: 'Location', value: 'https://example.com/cb?code=xyz&state=ok' },
              ],
              cookies: [{ name: 'session', value: 's3cr3t' }],
              content: { mimeType: 'application/json', text: JSON.stringify({ token: jwt, name: 'Ada' }) },
            },
          },
        ],
      },
    };
    const { har: clean, redactions } = stripHar(har);
    const text = JSON.stringify(clean);
    for (const secret of ['s3cr3t', 'abc123', 'hunter2', 'k-123456', 'sess-999', 'r-1', 'deadbeef', 'xyz', jwt]) {
      expect(text).not.toContain(secret);
    }
    // useful, non-secret data survives
    expect(text).toContain('page=2');
    expect(text).toContain('application/json');
    expect(text).toContain('Mozilla/5.0');
    expect(text).toContain('api.example.com');
    expect(text).toContain('Ada');
    expect(text).toContain('a@b.c');
    expect(redactions).toBeGreaterThanOrEqual(10);
  });

  it('redacts signed URL parameters but keeps the URL readable', () => {
    const u = redactUrl('https://storage.googleapis.com/b/o?X-Goog-Signature=abc&X-Goog-Date=20261103&alt=media');
    expect(u).not.toContain('=abc');
    expect(u).toContain('X-Goog-Date=20261103');
    expect(u).toContain('alt=media');
  });

  it('does not touch harmless names that only contain a short secret word', () => {
    const u = redactUrl('https://x.com/?author=jehad&outside=1&considered=yes');
    expect(u).toBe('https://x.com/?author=jehad&outside=1&considered=yes');
  });

  it('redacts token shapes inside free text and form bodies', () => {
    expect(redactText(`auth: Bearer abcdefghijklmnop and ${jwt}`)).not.toMatch(/abcdefghijklmnop|eyJhbGci/);
    expect(redactText('key sk_live_1234567890abcdef')).toContain(REDACTED);
    expect(redactBody('user=ada&password=hunter2', 'application/x-www-form-urlencoded')).not.toContain('hunter2');
  });
});
