// The first screen's text, placed where the site placed it (read from the live page at 1440×900).
// ✔ text, fonts, sizes, weights, colours and positions. ≈ units: viewport-relative absolute placement, not the site's own flex/grid.
const items = [
  {
    "k": "body:2>div:2",
    "tag": "div",
    "text": "three.js webgl - animation - keyframes\nModel: Littlest Tokyo by Glen Fox, CC Attribution.",
    "html": "<span style=\"color:rgb(41, 131, 255)\">three.js</span> webgl - animation - keyframes<br> Model: <span style=\"color:rgb(41, 131, 255)\">Littlest Tokyo</span> by <span style=\"color:rgb(41, 131, 255)\">Glen Fox</span>, CC Attribution.",
    "style": {
      "position": "absolute",
      "left": "0vw",
      "top": "0vh",
      "width": "100.14vw",
      "margin": "0",
      "fontFamily": "monospace",
      "fontSize": "max(10px, 0.9vw)",
      "fontWeight": "400",
      "letterSpacing": "normal",
      "lineHeight": "1.85",
      "color": "rgb(0, 0, 0)",
      "textTransform": "none",
      "textAlign": "center",
      "whiteSpace": "pre-wrap",
      "height": "8.68vh",
      "overflow": "hidden"
    }
  }
];
// ✔ where the site's canvas sat and the page background
const sceneCss = "html, body { background: rgb(226, 224, 224); }";


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
