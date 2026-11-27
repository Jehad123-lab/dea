// Scalable React / Next.js App Router code generator:
// Converts HeroLayout / PageLayer into semantic, responsive sections (flex/grid + fluid clamp() sizing)
// powered by motion/react (useScroll + useTransform) and Lenis smooth scroll, instead of raw fixed-px DOM dumps.

import type { HeroLayout } from './generate.ts';
import type { PageKey } from './pagelayer.ts';

export interface ResponsiveItem {
  id: string;
  tag: string;
  text: string;
  html?: string;
  src?: string;
  kind: 'text' | 'img' | 'video' | 'svg' | 'shape';
  fixed: boolean;
  kf?: PageKey[];
  win?: [number, number];
  xPct: number;
  wPct: number;
  y: number;
  h: number;
  fontSizeClamp?: string;
  style: Record<string, string>;
}

export interface LayoutSection {
  id: string;
  role: 'header' | 'section';
  yStart: number;
  yEnd: number;
  columns: number;
  items: ResponsiveItem[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fluid CSS clamp() from a measured desktop px value at reference viewport width. */
export function fluidClamp(px: number, vwWidth = 1440, minScale = 0.65): string {
  const min = Math.max(12, Math.round(px * minScale));
  const max = Math.round(px * 1.15);
  const vw = r2((px / vwWidth) * 100);
  return `clamp(${min}px, ${vw}vw, ${max}px)`;
}

/** Group HeroLayout / PageLayer elements into semantic fixed headers and vertical responsive sections. */
export function groupLayoutSections(layout: HeroLayout): {
  sections: LayoutSection[];
  wheelRatio: number;
  background: string | null;
} {
  const vw = Math.max(320, layout.viewport.width);
  const items: ResponsiveItem[] = [];
  const allowedTags = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'span', 'a', 'li', 'small', 'strong', 'em', 'button']);

  for (let i = 0; i < layout.boxes.length; i++) {
    const b = layout.boxes[i] as HeroLayout['boxes'][number] & { fx?: number; win?: [number, number]; kf?: PageKey[] };
    const tag = allowedTags.has(b.tag) ? b.tag : 'div';
    const fixed = Boolean(b.win || b.fx === 1);
    items.push({
      id: `box-${i}`,
      tag,
      text: b.text,
      ...(b.rich && /<span style=|<br>/.test(b.rich) ? { html: b.rich } : {}),
      kind: 'text',
      fixed,
      kf: b.kf,
      win: b.win,
      xPct: r2((b.x / vw) * 100),
      wPct: r2((b.w / vw) * 100),
      y: Math.round(b.y),
      h: Math.round(b.h),
      fontSizeClamp: fluidClamp(b.fontSize, vw),
      style: {
        fontFamily: b.fontFamily,
        fontSize: fluidClamp(b.fontSize, vw),
        fontWeight: String(b.fontWeight),
        lineHeight: b.lineHeight,
        color: b.color,
        textAlign: b.textAlign,
        ...(b.letterSpacing && b.letterSpacing !== 'normal' ? { letterSpacing: b.letterSpacing } : {}),
      },
    });
  }

  for (let i = 0; i < (layout.graphics ?? []).length; i++) {
    const g = layout.graphics![i] as NonNullable<HeroLayout['graphics']>[number] & { fx?: number; win?: [number, number]; kf?: PageKey[] };
    const fixed = Boolean(g.win || g.fx === 1);
    items.push({
      id: `gfx-${i}`,
      tag: g.kind === 'video' ? 'video' : g.kind === 'img' ? 'img' : 'div',
      text: '',
      ...(g.kind === 'svg' ? { html: g.svg ?? '' } : { src: g.src ?? '' }),
      kind: g.kind === 'svg' ? 'svg' : g.kind === 'video' ? 'video' : 'img',
      fixed,
      kf: g.kf,
      win: g.win,
      xPct: r2((g.x / vw) * 100),
      wPct: r2((g.w / vw) * 100),
      y: Math.round(g.y),
      h: Math.round(g.h),
      style: {
        width: '100%',
        maxWidth: `${Math.round(g.w)}px`,
        height: 'auto',
        objectFit: g.fit || 'cover',
        borderRadius: '12px',
      },
    });
  }

  const fixedItems = items.filter((it) => it.fixed);
  const flowItems = items.filter((it) => !it.fixed).sort((a, b) => a.y - b.y);

  const sections: LayoutSection[] = [];
  if (fixedItems.length) {
    sections.push({
      id: 'header',
      role: 'header',
      yStart: 0,
      yEnd: Math.max(...fixedItems.map((it) => it.y + it.h), 80),
      columns: Math.min(4, Math.max(1, fixedItems.length)),
      items: fixedItems,
    });
  }

  // Band flow items into responsive vertical sections (gap > 140px starts a new section)
  let current: ResponsiveItem[] = [];
  let bandEnd = 0;
  const flush = () => {
    if (!current.length) return;
    const yStart = Math.min(...current.map((c) => c.y));
    const yEnd = Math.max(...current.map((c) => c.y + c.h));
    // Estimate columns if items sit side-by-side in similar y-range
    const distinctRows = new Set(current.map((c) => Math.round(c.y / 80)));
    const columns = current.length > 1 && distinctRows.size === 1 ? Math.min(3, current.length) : 1;
    sections.push({
      id: `section-${sections.length + 1}`,
      role: 'section',
      yStart,
      yEnd,
      columns,
      items: current,
    });
    current = [];
  };

  for (const it of flowItems) {
    if (current.length && it.y - bandEnd > 140) flush();
    current.push(it);
    bandEnd = Math.max(bandEnd, it.y + it.h);
  }
  flush();

  return {
    sections,
    wheelRatio: layout.page?.wheelRatio ?? 1,
    background: layout.background ?? null,
  };
}

export function nextjsFiles(o: {
  title: string;
  heading: string;
  three: string;
  hasMotion: boolean;
  hasShader: boolean;
  shaderImportFile?: string;
  layout?: HeroLayout | null;
  sceneClientSource: string;
}): Record<string, string> {
  const files: Record<string, string> = {};
  const grouped = o.layout ? groupLayoutSections(o.layout) : null;
  const wheelRatio = grouped?.wheelRatio ?? 1;

  files['package.json'] = `${JSON.stringify(
    {
      name: 'dea-next-app',
      private: true,
      scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
      dependencies: {
        next: '^15.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        motion: '^12.0.0',
        lenis: '^1.1.0',
        three: o.three,
        '@react-three/fiber': '^9.0.0',
        gsap: '^3.12.5',
      },
      devDependencies: {
        '@types/node': '^22.0.0',
        '@types/react': '^19.0.0',
        typescript: '^5.6.0',
      },
    },
    null,
    2,
  )}\n`;

  files['next.config.mjs'] = `/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
};
export default nextConfig;
`;

  files['app/globals.css'] = `@import '../tokens/tokens.css';
@import '../motion/keyframes.css';

*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  min-height: 100%;
  overflow-x: hidden;
  ${grouped?.background ? `background: ${grouped.background};` : ''}
}

.dea-shell {
  position: relative;
  z-index: 1;
  width: 100%;
  min-height: 100dvh;
}

.dea-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: clamp(16px, 2vw, 32px) clamp(20px, 4vw, 64px);
}

.dea-section {
  width: min(1440px, 100%);
  margin: 0 auto;
  padding: clamp(48px, 8vh, 120px) clamp(20px, 5vw, 72px);
  display: grid;
  gap: clamp(16px, 2.5vw, 40px);
}
`;

  files['components/SmoothScroll.tsx'] = `'use client';

import { useEffect, type ReactNode } from 'react';
import Lenis from 'lenis';

export default function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    const lenis = new Lenis({
      lerp: 0.1,
      wheelMultiplier: ${wheelRatio},
      smoothWheel: true,
    });
    let raf = 0;
    const tick = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
`;

  files['components/MotionSection.tsx'] = `'use client';

import { motion, useScroll, useTransform } from 'motion/react';
import { useRef, type ReactNode } from 'react';

type Keyframe = [number, number, number, number, number, number];

export default function MotionSection({
  children,
  keyframes,
  className,
  style,
}: {
  children: ReactNode;
  keyframes?: Keyframe[];
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const hasKf = Boolean(keyframes && keyframes.length >= 2);
  const inputRange = hasKf ? keyframes!.map((k) => k[0]) : [0, 1];
  const opacityRange = hasKf ? keyframes!.map((k) => k[5]) : [1, 1];
  const yRange = hasKf ? keyframes!.map((k) => k[2] - keyframes![0][2]) : [0, 0];

  const opacity = useTransform(scrollY, inputRange, opacityRange);
  const y = useTransform(scrollY, inputRange, yRange);

  return (
    <motion.div
      ref={ref}
      className={className}
      style={hasKf ? { ...style, opacity, y } : style}
      initial={hasKf ? undefined : { opacity: 0, y: 18 }}
      whileInView={hasKf ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
`;

  files['components/Scene.tsx'] = o.sceneClientSource.startsWith("'use client'") ? o.sceneClientSource : `'use client';\n\n${o.sceneClientSource}`;

  const sectionsJson = JSON.stringify(grouped?.sections ?? [], null, 2);
  files['components/PageContent.tsx'] = `'use client';

import MotionSection from './MotionSection';

interface LayoutItem {
  id: string;
  tag: string;
  text: string;
  html?: string;
  src?: string;
  kind: 'text' | 'img' | 'video' | 'svg' | 'shape';
  kf?: [number, number, number, number, number, number][];
  style: Record<string, string>;
}

interface LayoutSection {
  id: string;
  role: 'header' | 'section';
  columns: number;
  items: LayoutItem[];
}

const SECTIONS: LayoutSection[] = ${sectionsJson};

function renderItem(it: LayoutItem) {
  if (it.kind === 'img') {
    return <img key={it.id} src={it.src} alt="" loading="lazy" style={it.style} />;
  }
  if (it.kind === 'video') {
    return <video key={it.id} src={it.src} autoPlay muted loop playsInline style={it.style} />;
  }
  if (it.html) {
    const Tag = it.tag as keyof React.JSX.IntrinsicElements;
    return <Tag key={it.id} style={it.style} dangerouslySetInnerHTML={{ __html: it.html }} />;
  }
  const Tag = it.tag as keyof React.JSX.IntrinsicElements;
  return (
    <Tag key={it.id} style={it.style}>
      {it.text}
    </Tag>
  );
}

export default function PageContent() {
  if (!SECTIONS.length) {
    return (
      <main className="dea-shell">
        <section className="dea-section">
          <MotionSection>
            <h1 style={{ fontSize: 'var(--dea-hero-size, clamp(32px, 5vw, 72px))', margin: 0 }}>${o.heading}</h1>
          </MotionSection>
        </section>
      </main>
    );
  }

  return (
    <main className="dea-shell">
      {SECTIONS.map((sec) =>
        sec.role === 'header' ? (
          <header key={sec.id} className="dea-header">
            {sec.items.map((it) => renderItem(it))}
          </header>
        ) : (
          <section
            key={sec.id}
            className="dea-section"
            style={{ gridTemplateColumns: sec.columns > 1 ? \`repeat(auto-fit, minmax(260px, 1fr))\` : '1fr' }}
          >
            {sec.items.map((it) => (
              <MotionSection key={it.id} keyframes={it.kf}>
                {renderItem(it)}
              </MotionSection>
            ))}
          </section>
        ),
      )}
    </main>
  );
}
`;

  files['app/layout.tsx'] = `import type { Metadata } from 'next';
import './globals.css';
import SmoothScroll from '../components/SmoothScroll';

export const metadata: Metadata = {
  title: ${JSON.stringify(`${o.title} (rebuilt with DEA)`)},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
`;

  files['app/page.tsx'] = `import Scene from '../components/Scene';
import PageContent from '../components/PageContent';

export default function HomePage() {
  return (
    <>
      <Scene />
      <PageContent />
    </>
  );
}
`;

  return files;
}
