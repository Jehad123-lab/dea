/**
 * Chrome DevTools Protocol calls used by the design decoder.
 * The Animation, CSS and DOM domains are marked experimental, so every CDP call
 * in DEA lives here: when Chrome changes, this is the one file to fix.
 */
import type { CDPSession } from 'playwright';

export interface AnimRecord {
  id: string;
  name: string;
  type: 'CSSTransition' | 'CSSAnimation' | 'WebAnimation' | string;
  duration: number;
  delay: number;
  iterations: number;
  direction: string;
  fill: string;
  easing: string;
  keyframeEasings: string[];
  keyframesRule: string | null;
  backendNodeId: number | null;
  target?: string;
  phase: string;
}

export interface AnimationWatch {
  events: AnimRecord[];
  phase: { name: string };
  stop(): Promise<void>;
}

/** Start listening to CSS transitions, CSS animations and Web Animations. Call before navigation to catch intros. */
export async function watchAnimations(cdp: CDPSession): Promise<AnimationWatch> {
  const events: AnimRecord[] = [];
  const phase = { name: 'load' };
  const seen = new Set<string>();
  const on = (p: any) => {
    const a = p?.animation;
    if (!a || seen.has(a.id) || events.length > 3000) return;
    seen.add(a.id);
    const s = a.source ?? {};
    events.push({
      id: a.id,
      name: a.name ?? '',
      type: a.type,
      duration: Number(s.duration ?? 0),
      delay: Number(s.delay ?? 0),
      iterations: Number(s.iterations ?? 1),
      direction: s.direction ?? 'normal',
      fill: s.fill ?? 'none',
      easing: s.easing ?? 'linear',
      keyframeEasings: (s.keyframesRule?.keyframes ?? []).map((k: any) => k.easing).filter(Boolean),
      keyframesRule: s.keyframesRule?.name ?? null,
      backendNodeId: s.backendNodeId ?? null,
      phase: phase.name,
    });
  };
  cdp.on('Animation.animationStarted', on);
  await cdp.send('Animation.enable').catch(() => {});
  return {
    events,
    phase,
    async stop() {
      cdp.off('Animation.animationStarted', on);
      await cdp.send('Animation.disable').catch(() => {});
    },
  };
}

/** Describe animation targets as short selectors (div.hero__title). */
export async function describeTargets(cdp: CDPSession, events: AnimRecord[]): Promise<void> {
  const cache = new Map<number, string>();
  for (const e of events.slice(0, 400)) {
    if (!e.backendNodeId) continue;
    if (!cache.has(e.backendNodeId)) {
      try {
        const { node } = (await cdp.send('DOM.describeNode', { backendNodeId: e.backendNodeId })) as any;
        const attrs: string[] = node.attributes ?? [];
        const get = (n: string) => {
          const i = attrs.indexOf(n);
          return i >= 0 ? attrs[i + 1] : '';
        };
        const id = get('id');
        const cls = get('class')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((c) => `.${c}`)
          .join('');
        cache.set(e.backendNodeId, `${String(node.localName || node.nodeName).toLowerCase()}${id ? `#${id}` : ''}${cls}`.slice(0, 80));
      } catch {
        cache.set(e.backendNodeId, 'element (gone)');
      }
    }
    e.target = cache.get(e.backendNodeId);
  }
}

export interface SheetText {
  url: string;
  inline: boolean;
  origin: string;
  text: string;
}

export interface CdpDomCss {
  sheets: SheetText[];
  platformFonts: Record<string, Array<{ familyName: string; postScriptName?: string; isCustomFont: boolean; glyphCount: number }>>;
}

/**
 * Turn on DOM + CSS, read every stylesheet's text (CDP can read cross-origin sheets the page itself cannot),
 * and ask Chrome which real fonts drew each element tagged with data-dea-font.
 */
export async function readDomAndCss(cdp: CDPSession, opts: { maxSheets?: number; maxSheetChars?: number; maxFontNodes?: number } = {}): Promise<CdpDomCss> {
  const headers: any[] = [];
  const onSheet = (p: any) => headers.push(p.header);
  cdp.on('CSS.styleSheetAdded', onSheet);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  await new Promise((r) => setTimeout(r, 300));
  cdp.off('CSS.styleSheetAdded', onSheet);

  // CDP calls are pipelined: on a busy page each round trip can wait for a frame, so send them together.
  const sheetHeaders = headers.filter((x) => x.origin === 'regular').slice(0, opts.maxSheets ?? 80);
  const texts = await Promise.all(
    sheetHeaders.map((h) =>
      (cdp.send('CSS.getStyleSheetText', { styleSheetId: h.styleSheetId }) as Promise<{ text: string }>).then(
        (r) => ({
          url: h.sourceURL || '(inline)',
          inline: !!h.isInline || !h.sourceURL,
          origin: h.origin,
          text: r.text.slice(0, opts.maxSheetChars ?? 1_500_000),
        }),
        () => null,
      ),
    ),
  );
  const sheets: SheetText[] = texts.filter((t): t is SheetText => t !== null);

  const platformFonts: CdpDomCss['platformFonts'] = {};
  try {
    const { root } = (await cdp.send('DOM.getDocument', { depth: 0 })) as any;
    const ids = Array.from({ length: opts.maxFontNodes ?? 40 }, (_, i) => String(i));
    await Promise.all(
      ids.map(async (fid) => {
        try {
          const { nodeId } = (await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-dea-font="${fid}"]` })) as any;
          if (!nodeId) return;
          const { fonts } = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })) as any;
          platformFonts[fid] = fonts;
        } catch {
          /* node detached */
        }
      }),
    );
  } catch {
    /* DOM not available */
  }
  return { sheets, platformFonts };
}
