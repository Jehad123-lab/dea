// The render pipeline of one recorded frame of https://threejs.org/examples/webgl_animation_keyframes.html, rebuilt by DEA.
// Verified: the order of the passes, the size and type of each render target, and which textures each pass read
// (recorded at the WebGL calls). Inferred: the wiring of samplers to targets below, and the scene hooks for passes
// that drew the site's own meshes with library materials.
import * as THREE from 'three';

export function createPipeline(renderer, hooks = {}) {
  const targets = {
  };
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const materials = {
  };
  const input = (material, wiring) => {
    for (const [sampler, id] of Object.entries(wiring)) if (material.uniforms[sampler] && targets[id]) material.uniforms[sampler].value = targets[id].texture;
  };
  const fullscreen = (material, wiring) => {
    input(material, wiring);
    quad.material = material;
    renderer.render(quadScene, quadCamera);
  };
  const passes = [
    { target: null, run: () => hooks.scene?.(renderer, { pass: 1, reads: ["t6","t7","t8","t9","t10","t11","t12"] }) }, // pass 1: SkyShader, outline, interiors… → screen (79 draws): draw your scene here
  ];
  return {
    targets,
    materials,
    passes,
    render(time = performance.now() / 1000) {
      for (const m of Object.values(materials)) for (const [k, u] of Object.entries(m.uniforms)) if (/time/i.test(k) && typeof u.value === "number") u.value = time;
      for (const p of passes) {
        renderer.setRenderTarget(p.target ? targets[p.target] ?? null : null);
        p.run();
      }
      renderer.setRenderTarget(null);
    },
  };
}
