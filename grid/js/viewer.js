/* ============================================================================
 * viewer.js — small three.js preview with hand-rolled orbit controls
 * ==========================================================================*/
(function (global) {
  'use strict';

  function Viewer(host) {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(dark ? 0x0d1017 : 0xe9edf3);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 8000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    host.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(dark ? 0x8899bb : 0xffffff, dark ? 0x101418 : 0x9aa4b4, dark ? 0.85 : 0.95));
    const key = new THREE.DirectionalLight(0xffffff, dark ? 0.75 : 0.65);
    key.position.set(0.6, -0.9, 1.4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-1, 0.6, 0.4);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(420, 10, dark ? 0x3a4457 : 0xb9c2d0, dark ? 0x232a36 : 0xd4dbe5);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.material = new THREE.MeshStandardMaterial({
      color: dark ? 0x8aa2ff : 0x4a68d8, metalness: 0.05, roughness: 0.62, flatShading: false
    });
    this.edgeMat = new THREE.LineBasicMaterial({ color: dark ? 0x0b0e14 : 0x203050, transparent: true, opacity: 0.35 });

    this.target = new THREE.Vector3(0, 0, 0);
    this.dist = 400; this.yaw = -0.6; this.pitch = 0.95;
    this._bind();
    this.resize();
    const self = this;
    const loop = function () { self._raf = requestAnimationFrame(loop); self._draw(); };
    loop();
    addEventListener('resize', function () { self.resize(); });
  }

  Viewer.prototype._bind = function () {
    const el = this.renderer.domElement, self = this;
    let down = false, btn = 0, px = 0, py = 0;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', function (e) {
      down = true; btn = e.button; px = e.clientX; py = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', function (e) {
      if (!down) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      px = e.clientX; py = e.clientY;
      if (btn === 0 && !e.shiftKey) {
        self.yaw -= dx * 0.008;
        self.pitch = Math.max(0.02, Math.min(Math.PI - 0.02, self.pitch - dy * 0.008));
      } else {
        const s = self.dist * 0.0016;
        const right = new THREE.Vector3(Math.cos(self.yaw), -Math.sin(self.yaw), 0);
        const up = new THREE.Vector3(0, 0, 1).cross(right).multiplyScalar(-1);
        self.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
      }
    });
    el.addEventListener('pointerup', function () { down = false; });
    el.addEventListener('pointercancel', function () { down = false; });
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.dist = Math.max(20, Math.min(4000, self.dist * (1 + Math.sign(e.deltaY) * 0.12)));
    }, { passive: false });
  };

  Viewer.prototype.resize = function () {
    const w = this.host.clientWidth || 640, h = this.host.clientHeight || 420;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  Viewer.prototype._draw = function () {
    const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + this.dist * sp * Math.cos(this.yaw),
      this.target.y + this.dist * sp * Math.sin(this.yaw),
      this.target.z + this.dist * cp
    );
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  };

  Viewer.prototype.clear = function () {
    while (this.group.children.length) {
      const c = this.group.children.pop();
      if (c.geometry) c.geometry.dispose();
    }
  };

  /* meshes: [{verts:Float64Array, tris:Uint32Array}] plus optional offsets */
  Viewer.prototype.show = function (meshes, opts) {
    opts = opts || {};
    this.clear();
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const m of meshes) {
      const pos = new Float32Array(m.verts.length);
      const off = m.offset || [0, 0, 0];
      for (let i = 0; i < m.verts.length; i += 3) {
        pos[i] = m.verts[i] + off[0];
        pos[i + 1] = m.verts[i + 1] + off[1];
        pos[i + 2] = m.verts[i + 2] + off[2];
        x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
        y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]);
        z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.tris), 1));
      g.computeVertexNormals();
      this.group.add(new THREE.Mesh(g, this.material));
    }
    if (!isFinite(x0)) return;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const size = Math.max(x1 - x0, y1 - y0, z1 - z0, 10);
    this.grid.scale.setScalar(Math.max(0.4, size / 300));
    if (opts.keepView !== true) {
      this.target.set(cx, cy, cz);
      this.dist = size * 2.1;
    }
  };

  global.Viewer = Viewer;
})(window);
