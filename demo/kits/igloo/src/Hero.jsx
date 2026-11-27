// The first screen's text, placed where the site placed it (read from the live page at 1440×900).
// ✔ text, fonts, sizes, weights, colours and positions. ≈ units: viewport-relative absolute placement, not the site's own flex/grid.
const items = [];
// ✔ where the site's canvas sat and the page background
const sceneCss = "html, body { background: rgb(160, 165, 177); }";


export default function Hero() {
  return (
    <>
    <section style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {sceneCss && <style>{sceneCss}</style>}
      {items.map((it, i) => {
        const Tag = it.tag;
        // an image by URL, an inline SVG read from the page, or a text block
        if (Tag === 'img') return <img key={i} data-dea-k={it.k} src={it.html} alt="" style={it.style} />;
        if (Tag === 'video') return <video key={i} data-dea-k={it.k} src={it.html} autoPlay muted loop playsInline onLoadedMetadata={(e) => { if (it.vt && e.currentTarget.duration > it.vt) e.currentTarget.currentTime = it.vt; }} style={it.style} />;
        if (it.html) return <Tag key={i} data-dea-k={it.k} style={it.style} dangerouslySetInnerHTML={{ __html: it.html }} />;
        return (
          <Tag key={i} data-dea-k={it.k} data-dea-h="0" style={it.style}>
            {it.text}
          </Tag>
        );
      })}
    </section>
    </>
  );
}
