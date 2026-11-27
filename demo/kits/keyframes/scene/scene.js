// The 3D scene DEA recovered from the site's GPU buffers: each mesh's geometry, its model matrix and the camera,
// as scene.glb (open it in Blender or any glTF viewer too). The look (the site's shaders, lighting, post-processing)
// is in the replay; this is the scene graph to build on: swap materials, add lights, animate the nodes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export async function mountRecoveredScene(el = document.body, o = {}) {
  const w = o.width || el.clientWidth || innerWidth;
  const h = o.height || el.clientHeight || innerHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!o.once });
  renderer.setPixelRatio(o.pixelRatio || Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  el.appendChild(renderer.domElement);
  const gltf = await new GLTFLoader().loadAsync(o.url || `${import.meta.env?.BASE_URL ?? '/'}scene/scene.glb`);
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x202028, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  if (o.material) gltf.scene.traverse((m) => { if (m.isMesh) m.material = o.material; });
  // the recorded camera: its world matrix is the inverse of the view matrix the site used
  let camera = gltf.cameras[0];
  if (camera && camera.isPerspectiveCamera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  } else if (!camera) {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    camera = new THREE.PerspectiveCamera(45, w / h, size / 100, size * 100);
    camera.position.copy(box.getCenter(new THREE.Vector3())).add(new THREE.Vector3(0, 0, size));
    camera.lookAt(box.getCenter(new THREE.Vector3()));
  }
  scene.updateMatrixWorld(true);
  const draw = () => renderer.render(scene, camera);
  if (o.once) draw();
  else renderer.setAnimationLoop(draw);
  return {
    scene,
    camera,
    renderer,
    gltf,
    dispose() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
