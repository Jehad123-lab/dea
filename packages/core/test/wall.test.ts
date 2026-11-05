import { describe, expect, it } from 'vitest';
import { BotProtectionError, classifyBotWall, type WallEvidence } from '../src/browser/wall.ts';

const base: WallEvidence = { status: 200, headers: {}, title: 'Home', text: '', textLength: 5000, markers: [] };

describe('bot protection wall', () => {
  it('recognises a PerimeterX press-and-hold page', () => {
    const w = classifyBotWall({
      ...base,
      status: 403,
      headers: { 'x-px-blocked': '1' },
      title: 'Access to this page has been denied',
      text: 'Press & Hold to confirm you are a human',
      textLength: 80,
      markers: ['px-captcha'],
    });
    expect(w?.vendor).toMatch(/PerimeterX/);
  });
  it('recognises a Cloudflare challenge', () => {
    const w = classifyBotWall({
      ...base,
      status: 403,
      headers: { 'cf-mitigated': 'challenge' },
      title: 'Just a moment...',
      text: 'Checking your browser before accessing',
      textLength: 60,
      markers: ['/cdn-cgi/challenge-platform/h/b'],
    });
    expect(w?.vendor).toBe('Cloudflare');
  });
  it('recognises a generic block page only when the page is thin', () => {
    expect(
      classifyBotWall({ ...base, status: 403, title: 'Access Denied', text: 'You do not have permission. Request blocked.', textLength: 90 }),
    ).not.toBeNull();
    expect(classifyBotWall({ ...base, status: 200, text: 'Access denied is a phrase in our blog post', textLength: 9000 })).toBeNull();
  });
  it('does not call a normal site a wall just because it loads a bot-protection script', () => {
    expect(
      classifyBotWall({ ...base, headers: { 'x-px-cookie': 'a' }, markers: ['https://client.px-cloud.net/PX123/main.min.js', 'challenge-platform'] }),
    ).toBeNull();
  });
  it('names the host and says nothing was captured', () => {
    const e = new BotProtectionError('https://www.zillow.com/', { vendor: 'PerimeterX / HUMAN', reason: 'x' }, 403);
    expect(e.message).toMatch(/Blocked by bot protection/);
    expect(e.message).toMatch(/no kit was written/);
    expect(e.message).toMatch(/www\.zillow\.com/);
  });
});
