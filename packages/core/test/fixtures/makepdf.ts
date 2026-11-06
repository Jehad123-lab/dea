/** A one-page PDF with a text layer, built by hand (no PDF library in the test). */
export function makePdf(lines: string[], pages = 1): Uint8Array {
  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  for (let p = 0; p < pages; p++) {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${4 + p * 2} 0 R /Resources << /Font << /F1 ${3 + pages * 2} 0 R >> >> >>`);
    const body = lines.length ? `BT /F1 12 Tf 20 150 Td ${lines.map((l) => `(${l} p${p + 1}) Tj 0 -16 Td`).join(' ')} ET` : '';
    objs.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const off: number[] = [];
  objs.forEach((o, i) => {
    off.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
