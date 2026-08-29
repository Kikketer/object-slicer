import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type PreviewSlice = {
  id: string;
  base_id: string;
  axis: "x" | "y" | "z";
  position: number;
  thickness: number;
  transform?: number[][];
  paths: number[][][];
};

const axisColors: Record<string, number> = { x: 0xd4b483, y: 0xc49a6b, z: 0x8f6a42 };

export function createPreview3D(container: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  camera.position.set(150, 150, 150);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(50, 100, 50);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xcccccc));

  const sliceGroup = new THREE.Group();
  scene.add(sliceGroup);

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(container);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let slices: PreviewSlice[] = [];
  let onSelect: ((s: PreviewSlice | null) => void) | undefined;

  function updateMaterials(activeId?: string) {
    sliceGroup.children.forEach((child) => {
      const m = child as THREE.Mesh;
      const mat = m.material as THREE.MeshPhongMaterial;
      if (activeId && m.userData.id === activeId) {
        mat.emissive.setHex(0xff5500);
      } else {
        mat.emissive.setHex(0x000000);
      }
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  container.addEventListener("pointerdown", (e) => {
    const rect = container.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(sliceGroup.children);
    if (intersects.length) {
      const data = (intersects[0].object as THREE.Mesh).userData as PreviewSlice;
      if (data && onSelect) onSelect(data);
    } else {
      updateMaterials(undefined);
      if (onSelect) onSelect(null);
    }
  });

  return {
    setPreview: (data: PreviewSlice[], selectCb?: (s: PreviewSlice | null) => void) => {
      slices = data;
      onSelect = selectCb;
      sliceGroup.clear();
      for (const s of data) {
        const shape = new THREE.Shape();
        if (!s.paths.length) continue;
        const ext = s.paths[0];
        shape.moveTo(ext[0][0], ext[0][1]);
        for (let i = 1; i < ext.length; i++) shape.lineTo(ext[i][0], ext[i][1]);
        shape.closePath();
        for (let h = 1; h < s.paths.length; h++) {
          const hole = s.paths[h];
          const path = new THREE.Path();
          path.moveTo(hole[0][0], hole[0][1]);
          for (let i = 1; i < hole.length; i++) path.lineTo(hole[i][0], hole[i][1]);
          path.closePath();
          shape.holes.push(path);
        }
        const geom = new THREE.ExtrudeGeometry(shape, {
          depth: s.thickness,
          bevelEnabled: false,
          steps: 1,
          curveSegments: 1,
        });
        if (s.transform) {
          const flat = s.transform.flat();
          const matrix = new THREE.Matrix4();
          if (flat.length === 16) {
            matrix.set(
              flat[0], flat[1], flat[2], flat[3],
              flat[4], flat[5], flat[6], flat[7],
              flat[8], flat[9], flat[10], flat[11],
              flat[12], flat[13], flat[14], flat[15]
            );
            geom.applyMatrix4(matrix);
          }
        }
        const mat = new THREE.MeshPhongMaterial({
          color: axisColors[s.axis] ?? 0xcccccc,
          side: THREE.DoubleSide,
          transparent: false,
          opacity: 1.0,
          shininess: 5,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.userData = s;
        sliceGroup.add(mesh);
      }
    },
    highlight: (slice: PreviewSlice) => updateMaterials(slice.id),
    clearHighlight: () => updateMaterials(undefined),
    dispose: () => {
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
