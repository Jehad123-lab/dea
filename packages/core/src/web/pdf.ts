/**
 * PDF text, from the PDF's own text layer, with unpdf (MIT; it bundles Mozilla's pdf.js, Apache-2.0). A PDF that is a scan
 * (pictures of pages, no text layer) yields no text: DEA says so and does not guess (no OCR is built in).
 */
export interface PdfText {
  text: string;
  total: number;
  read: number;
  title: string;
  /** characters per page, in order: lets a caller see which pages had a text layer at all */
  perPage: number[];
}

export const isPdf = (bytes: Uint8Array, contentType = ''): boolean =>
  /application\/pdf/i.test(contentType) || (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

export async function pdfText(bytes: Uint8Array, o: { maxPages?: number } = {}): Promise<PdfText> {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 } as never).catch((e: Error) => {
    throw new Error(`The PDF could not be read (${e.message.replace(/\.$/, '')}); it may be damaged, encrypted with a password, or cut off.`);
  });
  try {
    const total = pdf.numPages;
    const read = Math.min(total, Math.max(1, o.maxPages ?? 40));
    const pages: string[] = [];
    for (let n = 1; n <= read; n++) {
      const page = await pdf.getPage(n);
      const tc = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const it of tc.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof it.str !== 'string') continue;
        line += it.str;
        if (it.hasEOL) {
          lines.push(line);
          line = '';
        }
      }
      if (line) lines.push(line);
      pages.push(
        lines
          .join('\n')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim(),
      );
    }
    let title = '';
    try {
      const meta = (await pdf.getMetadata()) as { info?: { Title?: unknown } };
      title = typeof meta.info?.Title === 'string' ? meta.info.Title.trim() : '';
    } catch {
      /* no metadata is fine */
    }
    return {
      text: pages
        .map((p, i) => (p ? `[page ${i + 1}]\n${p}` : ''))
        .filter(Boolean)
        .join('\n\n'),
      total,
      read,
      title,
      perPage: pages.map((p) => p.length),
    };
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.()?.catch(() => {});
  }
}
