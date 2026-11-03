import * as generatorModule from '@babel/generator';
import { parse } from '@babel/parser';
import type { LoadedMap, ScriptRecord } from './scripts.ts';
import { isLibraryPath } from './scripts.ts';

// @babel/generator is CommonJS; under ESM its function may sit one or two levels down
type Gen = (ast: unknown, opts?: Record<string, unknown>) => { code: string };
const gm = generatorModule as any;
const generate: Gen = typeof gm.default === 'function' ? gm.default : typeof gm.default?.default === 'function' ? gm.default.default : gm.generate;

export interface Excerpt {
  /** original = from the site's own source map (the author's real file); bundle = the shipped file, re-indented by DEA */
  from: 'original' | 'bundle';
  file: string;
  line: number;
  /** the enclosing function or component name when DEA can tell */
  name: string | null;
  code: string;
}

type Node = { type: string; start: number; end: number; [k: string]: any };

const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);

/** Code lookups across a page's scripts, its source maps, and its unpacked bundles. */
export interface StaticTween {
  method: string;
  target: string;
  props: Record<string, string>;
  file: string;
  line: number;
  /** column, for one-line minified bundles */
  col?: number;
  from: 'original' | 'bundle';
}

function lowerBound(starts: number[], off: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export class CodeIndex {
  private byUrl = new Map<string, ScriptRecord>();
  private byId = new Map<string, ScriptRecord>();
  private maps = new Map<string, LoadedMap>();
  private asts = new Map<string, Node | null>();
  private lineStarts = new Map<string, number[]>();

  constructor(
    readonly scripts: ScriptRecord[],
    maps: LoadedMap[],
  ) {
    for (const s of scripts) {
      if (!this.byUrl.has(s.url) || s.role !== 'inline') this.byUrl.set(s.url, s);
      this.byId.set(s.scriptId, s);
    }
    for (const m of maps) this.maps.set(m.script, m);
  }

  script(urlOrId: string): ScriptRecord | undefined {
    return this.byUrl.get(urlOrId) ?? this.byId.get(urlOrId);
  }

  hasMap(url: string): boolean {
    return this.maps.has(url);
  }

  /** A readable excerpt for a 1-based line/column in a shipped script. */
  at(urlOrId: string, line: number, col: number, maxLines = 40): Excerpt | null {
    const s = this.script(urlOrId);
    if (!s) return null;
    const m = this.maps.get(s.url);
    if (m) {
      const pos = m.consumer.originalPositionFor({ line, column: Math.max(0, col - 1) });
      if (pos.source && pos.line) {
        const text = m.contents.get(pos.source);
        if (text) return { from: 'original', file: pos.source, line: pos.line, name: enclosingName(text, pos.line), code: lines(text, pos.line, 8) };
        return {
          from: 'original',
          file: pos.source,
          line: pos.line,
          name: pos.name ?? null,
          code: '(the source map names this file but does not include its text)',
        };
      }
    }
    const off = this.offset(s, line, col);
    return this.around(s, off, maxLines);
  }

  /** The smallest whole function around a character offset in a script, printed readably. */
  around(s: ScriptRecord, offset: number, maxLines = 40): Excerpt | null {
    const ast = this.ast(s);
    const fileName = s.url.split('/').pop()?.split('?')[0] || s.url;
    const lineNo = this.lineOf(s, offset);
    if (!ast) {
      const a = Math.max(0, offset - 300);
      return { from: 'bundle', file: fileName, line: lineNo, name: null, code: s.source.slice(a, offset + 500) };
    }
    const path: Node[] = [];
    walk(ast, offset, path);
    let pick: Node | null = null;
    for (let i = path.length - 1; i >= 0; i--) {
      const n = path[i];
      if (FN.has(n.type) && n.end - n.start < 9000) {
        pick = n;
        // a tiny arrow inside a call reads better with its caller
        if (n.end - n.start < 160 && i > 0) {
          for (let j = i - 1; j >= 0; j--) {
            if ((FN.has(path[j].type) || /Statement|Declaration/.test(path[j].type)) && path[j].end - path[j].start < 9000) {
              pick = path[j];
              break;
            }
          }
        }
        break;
      }
    }
    if (!pick) pick = [...path].reverse().find((n) => /Statement|Declaration/.test(n.type) && n.end - n.start < 6000) ?? null;
    if (!pick) {
      const a = Math.max(0, offset - 300);
      return { from: 'bundle', file: fileName, line: lineNo, name: null, code: s.source.slice(a, offset + 500) };
    }
    let code: string;
    try {
      code = generate(pick as any, { comments: false, compact: false, retainLines: false }).code;
    } catch {
      code = s.source.slice(pick.start, pick.end);
    }
    const out = code.split('\n');
    return {
      from: 'bundle',
      file: fileName,
      line: lineNo,
      name: fnName(pick, path),
      code: out.length > maxLines ? `${out.slice(0, maxLines).join('\n')}\n  // … ${out.length - maxLines} more lines` : code,
    };
  }

  /**
   * Where does the site's own code mention this string (a class name, an id, a uniform)? Original sources first,
   * then app bundles. Returns at most `limit` places.
   */
  find(needle: string, limit = 3): Excerpt[] {
    if (!needle || needle.length < 3) return [];
    const out: Excerpt[] = [];
    const quoted = new RegExp(`["'\`.#\\s]${escapeRe(needle)}(?![\\w-])`);
    for (const m of this.maps.values()) {
      for (const [src, text] of m.contents) {
        if (isLibraryPath(src)) continue;
        const i = text.search(quoted);
        if (i < 0) continue;
        const line = text.slice(0, i).split('\n').length;
        out.push({ from: 'original', file: src, line, name: enclosingName(text, line), code: lines(text, line, 6) });
        if (out.length >= limit) return out;
      }
    }
    for (const s of this.scripts) {
      if (s.role === 'vendor' || this.maps.has(s.url)) continue;
      const i = s.source.search(quoted);
      if (i < 0) continue;
      const e = this.around(s, i + 1, 30);
      if (e) out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * GSAP calls written in the code, found by reading it (not by watching it run): gsap.to/from/fromTo/set/timeline and
   * timeline .to/.from chains with a literal vars object that has duration/ease/stagger/scrollTrigger. These include
   * animations that only run after a click or a state change.
   */
  staticTweens(limit = 120): StaticTween[] {
    const out: StaticTween[] = [];
    const visit = (
      ast: Node,
      fileLabel: string,
      lineOf: (off: number) => number,
      from: 'original' | 'bundle',
      src: string,
      colOf?: (off: number) => number,
    ) => {
      const stack: Node[] = [ast];
      while (stack.length && out.length < limit) {
        const n = stack.pop() as Node;
        if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && !n.callee.computed) {
          const method = n.callee.property?.name as string | undefined;
          if (method && /^(to|from|fromTo|set|timeline)$/.test(method)) {
            const objs = (n.arguments as Node[]).filter((a) => a.type === 'ObjectExpression');
            const vars = objs[objs.length - 1];
            const keys = vars ? (vars.properties as Node[]).map((p) => p.key?.name ?? p.key?.value).filter(Boolean) : [];
            const gsapish = keys.some((k: string) => /^(duration|ease|stagger|scrollTrigger|yoyo|repeat|autoAlpha|overwrite|delay)$/.test(k));
            if (gsapish || (method === 'timeline' && /gsap/i.test(src.slice(n.callee.start, n.callee.end)))) {
              const props: Record<string, string> = {};
              for (const p of (vars?.properties ?? []) as Node[]) {
                const k = p.key?.name ?? p.key?.value;
                if (!k || /^on[A-Z]/.test(k)) continue;
                const v = p.value;
                props[k] = v
                  ? v.type === 'StringLiteral'
                    ? JSON.stringify(v.value)
                    : v.type === 'NumericLiteral' || v.type === 'BooleanLiteral'
                      ? String(v.value)
                      : src.slice(v.start, Math.min(v.end, v.start + 60)).replace(/\s+/g, ' ')
                  : '?';
              }
              const target =
                n.arguments[0] && method !== 'timeline'
                  ? src.slice(n.arguments[0].start, Math.min(n.arguments[0].end, n.arguments[0].start + 60)).replace(/\s+/g, ' ')
                  : '';
              const at = n.callee.property?.start ?? n.start; // a chain (tl.to().to()) starts every call at the same place
              out.push({ method, target, props, file: fileLabel, line: lineOf(at), ...(colOf ? { col: colOf(at) } : {}), from });
            }
          }
        }
        for (const key of Object.keys(n)) {
          if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) continue;
          const v = n[key];
          if (Array.isArray(v)) {
            for (let i = v.length - 1; i >= 0; i--) if (v[i] && typeof v[i].type === 'string') stack.push(v[i]);
          } else if (v && typeof v.type === 'string') stack.push(v);
        }
      }
    };
    for (const m of this.maps.values()) {
      for (const [src, text] of m.contents) {
        if (isLibraryPath(src) || !/\.(m?[jt]sx?|vue|svelte)$/.test(src.split('?')[0]) || text.length > 1_500_000) continue;
        let ast: Node | null = null;
        try {
          ast = parse(text, { sourceType: 'unambiguous', errorRecovery: true, plugins: ['jsx', 'typescript'] }) as unknown as Node;
        } catch {
          continue;
        }
        const starts = [0];
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
        visit(ast, src, (off) => lowerBound(starts, off) + 1, 'original', text);
      }
    }
    for (const s of this.scripts) {
      if (s.role === 'vendor' || s.role === 'inline' || this.maps.has(s.url) || /GreenSock|_ptLookup/.test(s.source.slice(0, 400_000))) continue;
      const ast = this.ast(s);
      if (ast)
        visit(
          ast,
          s.url.split('/').pop()?.split('?')[0] ?? s.url,
          (off) => this.lineOf(s, off),
          'bundle',
          s.source,
          (off) => off - (this.starts(s)[this.lineOf(s, off) - 1] ?? 0) + 1,
        );
    }
    // in reading order, per file (the walk above visits a chain's last call first)
    const order = new Map<string, number>();
    for (const t of out) if (!order.has(t.file)) order.set(t.file, order.size);
    out.sort((a, b) => (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0) || a.line - b.line || (a.col ?? 0) - (b.col ?? 0));
    return out;
  }

  private ast(s: ScriptRecord): Node | null {
    if (this.asts.has(s.url)) return this.asts.get(s.url) ?? null;
    let ast: Node | null = null;
    if (s.source.length < 8_000_000) {
      try {
        ast = parse(s.source, { sourceType: 'unambiguous', errorRecovery: true, allowReturnOutsideFunction: true, plugins: ['jsx'] }) as unknown as Node;
      } catch {
        ast = null;
      }
    }
    this.asts.set(s.url, ast);
    return ast;
  }

  private offset(s: ScriptRecord, line: number, col: number): number {
    const starts = this.starts(s);
    return (starts[line - 1] ?? 0) + Math.max(0, col - 1);
  }

  private lineOf(s: ScriptRecord, offset: number): number {
    const starts = this.starts(s);
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  private starts(s: ScriptRecord): number[] {
    let st = this.lineStarts.get(s.url);
    if (!st) {
      st = [0];
      for (let i = 0; i < s.source.length; i++) if (s.source.charCodeAt(i) === 10) st.push(i + 1);
      this.lineStarts.set(s.url, st);
    }
    return st;
  }
}

function walk(node: Node, offset: number, path: Node[]): void {
  path.push(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'extra') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v)
        if (c && typeof c.type === 'string' && c.start <= offset && offset < c.end) {
          walk(c, offset, path);
          return;
        }
    } else if (v && typeof v.type === 'string' && v.start <= offset && offset < v.end) {
      walk(v, offset, path);
      return;
    }
  }
}

function fnName(n: Node, path: Node[]): string | null {
  if (n.id?.name) return n.id.name;
  if (n.key?.name) return n.key.name;
  const i = path.indexOf(n);
  const p = path[i - 1];
  if (p?.type === 'VariableDeclarator' && p.id?.name) return p.id.name;
  if (p?.type === 'AssignmentExpression' && p.left?.property?.name) return p.left.property.name;
  if (p?.type === 'ObjectProperty' && p.key?.name) return p.key.name;
  if (p?.type === 'CallExpression') {
    const c = p.callee;
    const name = c?.property?.name ?? c?.name;
    if (name) return `callback of ${name}()`;
  }
  return null;
}

function lines(text: string, line: number, around: number): string {
  const all = text.split('\n');
  const a = Math.max(0, line - 1 - around);
  const b = Math.min(all.length, line + around);
  return all
    .slice(a, b)
    .map((l, i) => `${a + i + 1 === line ? '>' : ' '} ${String(a + i + 1).padStart(4)}  ${l.length > 160 ? `${l.slice(0, 160)}…` : l}`)
    .join('\n');
}

/** The nearest function or component name above a line in original source. */
function enclosingName(text: string, line: number): string | null {
  const all = text.split('\n').slice(0, line).reverse();
  for (const l of all) {
    const m =
      /(?:export\s+)?(?:default\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(l) ??
      /(?:const|let|var)\s+([A-Z][\w$]*)\s*=\s*(?:\(|function|React\.|memo|forwardRef)/.exec(l) ??
      /class\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (m) return m[1];
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
