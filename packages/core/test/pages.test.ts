import { describe, expect, it } from 'vitest';
import { matchedTerms, pageTerms, rankLinks } from '../src/index.ts';

// the kind of links gsap.com's home page has
const gsapLinks = [
  { url: 'https://gsap.com/docs/v3/', label: 'Docs' },
  { url: 'https://gsap.com/resources/', label: 'Learning Center' },
  { url: 'https://gsap.com/showcase/', label: 'Showcase' },
  { url: 'https://gsap.com/pricing/', label: 'Pricing' },
  { url: 'https://gsap.com/pricing', label: '' },
  { url: 'https://gsap.com/community/', label: 'Community' },
  { url: 'https://gsap.com/blog/', label: 'Blog' },
  { url: 'https://gsap.com/discuss/forum/', label: 'Forums' },
  { url: 'https://gsap.com/docs/v3/Plugins/ScrollTrigger/', label: 'ScrollTrigger' },
  { url: 'https://gsap.com/login/', label: 'Log in' },
  { url: 'https://gsap.com/text-plugins/', label: 'Text plugins' },
];

describe('brain: choosing pages', () => {
  it('keeps only goal words that name a page topic', () => {
    expect(pageTerms('What fonts does it use and what do the pricing and showcase pages say?', 'https://gsap.com')).toEqual(['pricing', 'showcase']);
    // analysis words (fonts, colours, built, stack) and the site's own name never pick pages
    expect(pageTerms('which fonts and colours, what is it built with, what do its main pages cover', 'https://gsap.com')).toEqual([]);
    expect(pageTerms('what does gsap.com say about scrolltrigger', 'https://gsap.com')).toEqual(['scrolltrigger']);
  });

  it('matches whole words only: "css" is not in "discuss", "text" is not in "context"', () => {
    expect(matchedTerms('/discuss/forum/', ['css'])).toEqual([]);
    expect(matchedTerms('/context/', ['text'])).toEqual([]);
    expect(matchedTerms('/text-plugins/', ['text'])).toEqual(['text']);
    expect(matchedTerms('Showcases', ['showcase'])).toEqual(['showcase']);
  });

  it('picks only links that match, one per page, best match first', () => {
    const picks = rankLinks(gsapLinks, ['pricing', 'showcase'], 4);
    expect(picks.map((p) => p.url)).toEqual(['https://gsap.com/showcase/', 'https://gsap.com/pricing/']);
    expect(picks[0].why).toMatch(/matched "showcase" in its address/);
  });

  it('with no page topic, reads a labelled sample of top-level pages (never login or legal pages)', () => {
    const picks = rankLinks(gsapLinks, [], 4);
    expect(picks).toHaveLength(4);
    expect(picks.every((p) => p.matched.length === 0 && /sample of the main pages/.test(p.why))).toBe(true);
    expect(picks.map((p) => p.url)).not.toContain('https://gsap.com/login/');
    expect(picks.map((p) => p.url)).not.toContain('https://gsap.com/docs/v3/Plugins/ScrollTrigger/');
  });

  it('says so when goal words match no link, instead of pretending', () => {
    const picks = rankLinks(gsapLinks, ['careers'], 3);
    expect(picks[0].why).toBe('a sample of the main pages (no link matched "careers")');
  });
});
