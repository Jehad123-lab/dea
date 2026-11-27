// The editable rebuild: the site's render graph as three.js objects (rebuild/rebuild.js reads public/rebuild/pipeline.json).
// Each draw is a RawShaderMaterial with the site's GLSL (public/rebuild/shaders/), cameras and model matrices are three.js
// matrices, framebuffers are WebGLRenderTargets. rb.uniforms[i].name.value, rb.setPassEnabled(i, false) and the shader
// files change it. Vertex and texture bytes are recorded from the site (see rebuild.md for where).
import { useEffect, useRef } from 'react';
import { mountRebuild } from '../rebuild/rebuild.js';

export default function Scene() {
  const ref = useRef(null);
  useEffect(() => {
    let rb = null;
    let dead = false;
    mountRebuild(ref.current, { base: `${import.meta.env?.BASE_URL ?? '/'}rebuild/` }).then((r) => {
      rb = r;
      if (dead) r.stop();
    });
    return () => {
      dead = true;
      if (rb) {
        rb.stop();
        rb.renderer.dispose();
        rb.renderer.domElement.remove();
      }
    };
  }, []);
  return <div ref={ref} className="dea-scene" style={{ position: 'fixed', inset: 0, zIndex: 0 }} />;
}
