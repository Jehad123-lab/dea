import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { mountRebuild } from '../rebuild/rebuild.js';

function attachOrbit(rb) {
  const cams = (rb.cameras || [])
    .map((cam) => {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      cam.matrixWorld.decompose(pos, quat, scale);
      const dist = pos.length();
      if (!cam.isPerspectiveCamera || dist < 1e-4) return null;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat).normalize();
      const target = pos.clone().addScaledVector(forward, dist);
      const offset = pos.clone().sub(target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      return { cam, target, baseSph: sph.clone(), sph: sph.clone(), up: new THREE.Vector3(0, 1, 0) };
    })
    .filter(Boolean);
  if (!cams.length) return () => {};

  let yaw = 0;
  let pitch = 0;
  let zoom = 1;
  let dragging = false;
  let lx = 0;
  let ly = 0;

  const apply = () => {
    for (const c of cams) {
      c.sph.theta = c.baseSph.theta + yaw;
      c.sph.phi = Math.max(0.08, Math.min(Math.PI - 0.08, c.baseSph.phi + pitch));
      c.sph.radius = Math.max(c.baseSph.radius * 0.2, Math.min(c.baseSph.radius * 4, c.baseSph.radius * zoom));
      const pos = new THREE.Vector3().setFromSpherical(c.sph).add(c.target);
      const m = new THREE.Matrix4().lookAt(pos, c.target, c.up);
      m.setPosition(pos);
      c.cam.matrixWorld.copy(m);
      c.cam.matrix.copy(m);
      c.cam.matrixWorldInverse.copy(m).invert();
    }
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
  };
  const onMove = (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lx) * 0.006;
    pitch -= (e.clientY - ly) * 0.006;
    lx = e.clientX;
    ly = e.clientY;
    apply();
  };
  const onUp = () => {
    dragging = false;
  };
  const onWheel = (e) => {
    e.preventDefault();
    zoom = Math.max(0.25, Math.min(3.5, zoom * (1 + e.deltaY * 0.001)));
    apply();
  };
  const onDbl = () => {
    yaw = 0;
    pitch = 0;
    zoom = 1;
    apply();
  };

  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('dblclick', onDbl);
  return () => {
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('dblclick', onDbl);
  };
}

export default function Scene() {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let rb = null;
    let dead = false;
    let detach = () => {};
    mountRebuild(ref.current, { base: `${import.meta.env?.BASE_URL ?? '/'}rebuild/` }).then((r) => {
      rb = r;
      if (dead) {
        r.stop();
        return;
      }
      detach = attachOrbit(r);
      setReady(true);
    });
    return () => {
      dead = true;
      detach();
      if (rb) {
        rb.stop();
        rb.renderer.dispose();
        rb.renderer.domElement.remove();
      }
    };
  }, []);
  return (
    <>
      <div ref={ref} className="dea-scene" style={{ position: 'fixed', inset: 0, zIndex: 0, cursor: 'grab' }} />
      <div
        style={{
          position: 'fixed',
          left: 16,
          bottom: 16,
          zIndex: 10,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '8px 14px',
          borderRadius: 999,
          background: 'rgba(11, 11, 12, 0.72)',
          backdropFilter: 'blur(8px)',
          color: '#f2f2f2',
          font: '500 12px/1.2 Inter, system-ui, sans-serif',
          letterSpacing: '0.01em',
          userSelect: 'none',
        }}
      >
        <a href="../" style={{ color: '#fff', textDecoration: 'none' }}>
          ← All demos
        </a>
        <span style={{ opacity: 0.45 }}>·</span>
        <span style={{ opacity: 0.8 }}>{ready ? 'Drag to orbit · Scroll to zoom · Double-click to reset' : 'Loading 3D scene…'}</span>
      </div>
    </>
  );
}
