import * as THREE from "three";
import { exhibitSpec, layoutPositions } from "./exhibits.js";

export const HALL_RADIUS = 12;

const STONE = 0x4a4238;
const FLOOR = 0x26201a;
const WALL = 0x1a140f;
const DUST_COLOR = 0xd9b98a;

function artifactGeometry(geometry) {
  switch (geometry.shape) {
    case "octahedron": return new THREE.OctahedronGeometry(0.6, geometry.detail);
    case "dodecahedron": return new THREE.DodecahedronGeometry(0.58, geometry.detail);
    case "icosahedron": return new THREE.IcosahedronGeometry(0.6, geometry.detail);
    case "box": return new THREE.BoxGeometry(0.62, 0.88, 0.34);
    default: return new THREE.TetrahedronGeometry(0.66, geometry.detail);
  }
}

/**
 * Renderer + scene + camera shell. Throws when WebGL is unavailable; the
 * caller turns that into the fallback overlay.
 */
export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0906);
  scene.fog = new THREE.FogExp2(0x0b0906, 0.026);

  const camera = new THREE.PerspectiveCamera(
    55,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.1,
    140
  );
  camera.position.set(0, 2.4, 9);
  camera.lookAt(0, 1.4, 0);

  scene.add(new THREE.HemisphereLight(0x8a7a5c, 0x14100a, 0.55));

  const onResize = () => {
    const width = container.clientWidth;
    const height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  window.addEventListener("resize", onResize);

  return {
    renderer,
    scene,
    camera,
    render: () => renderer.render(scene, camera),
    dispose() {
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}

function stoneMaterial(color, roughness = 0.95) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02, flatShading: true });
}

/**
 * Builds one exhibition hall: floor, walls, columns, reading table with the
 * latest checkpoint, one pedestal + floating artifact per memory, warm
 * spotlights with fake volumetric cones, and drifting light-dust particles.
 */
export function buildGallery(scene, { memories = [], checkpoint = null, eventCount = 0 } = {}) {
  const group = new THREE.Group();
  const disposables = [];
  const track = resource => {
    disposables.push(resource);
    return resource;
  };

  // Architecture.
  const floor = new THREE.Mesh(track(new THREE.CircleGeometry(HALL_RADIUS + 3, 48)), track(stoneMaterial(FLOOR)));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const wall = new THREE.Mesh(
    track(new THREE.CylinderGeometry(HALL_RADIUS + 3, HALL_RADIUS + 3, 7.5, 32, 1, true)),
    track(new THREE.MeshStandardMaterial({ color: WALL, roughness: 1, side: THREE.BackSide }))
  );
  wall.position.y = 3.75;
  group.add(wall);

  const ceiling = new THREE.Mesh(track(new THREE.CircleGeometry(HALL_RADIUS + 3, 32)), track(stoneMaterial(0x120e0a)));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 7.5;
  group.add(ceiling);

  const columnGeometry = track(new THREE.CylinderGeometry(0.35, 0.45, 7.5, 8));
  const columnMaterial = track(stoneMaterial(0x332b22));
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2 + Math.PI / 8;
    const column = new THREE.Mesh(columnGeometry, columnMaterial);
    column.position.set(Math.cos(angle) * (HALL_RADIUS + 2), 3.75, Math.sin(angle) * (HALL_RADIUS + 2));
    group.add(column);
  }

  // Central reading table carrying the latest checkpoint.
  const tableBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 0.65, 0.9, 10)), track(stoneMaterial(STONE)));
  tableBase.position.y = 0.45;
  const tableTop = new THREE.Mesh(track(new THREE.CylinderGeometry(1.5, 1.3, 0.14, 24)), track(stoneMaterial(0x5a5045, 0.85)));
  tableTop.position.y = 0.97;
  group.add(tableBase, tableTop);

  let checkpointSlab = null;
  if (checkpoint) {
    checkpointSlab = new THREE.Mesh(
      track(new THREE.BoxGeometry(1.15, 0.06, 0.8)),
      track(new THREE.MeshStandardMaterial({
        color: 0xd8c49a,
        emissive: 0x9c7c3f,
        emissiveIntensity: 0.5,
        roughness: 0.6
      }))
    );
    checkpointSlab.position.set(0, 1.25, 0);
    checkpointSlab.userData.checkpoint = true;
    group.add(checkpointSlab);
    const tableLight = new THREE.PointLight(0xffd9a0, 6, 6, 1.8);
    tableLight.position.set(0, 2.1, 0);
    group.add(tableLight);
  }

  // Exhibits around the hall ring.
  const exhibits = new Map();
  const positions = layoutPositions(memories.length, HALL_RADIUS - 2.5);
  memories.forEach((memory, index) => {
    const spec = exhibitSpec(memory);
    const { x, z, angle } = positions[index];

    const pedestal = new THREE.Mesh(
      track(new THREE.CylinderGeometry(spec.pedestal.radius, spec.pedestal.radius * 1.15, spec.pedestal.height, 10)),
      track(stoneMaterial(spec.pedestal.color))
    );
    pedestal.position.set(x, spec.pedestal.height / 2, z);
    pedestal.userData.exhibitId = memory.memoryId;
    group.add(pedestal);

    const material = track(new THREE.MeshStandardMaterial({
      color: spec.style.color,
      emissive: spec.style.emissive,
      emissiveIntensity: spec.style.emissiveIntensity,
      roughness: 0.35,
      metalness: 0.1,
      flatShading: true,
      transparent: spec.style.transparent,
      opacity: spec.style.opacity
    }));
    const artifact = new THREE.Mesh(track(artifactGeometry(spec.geometry)), material);
    artifact.scale.setScalar(spec.scale);
    artifact.position.set(x, spec.hoverHeight, z);
    artifact.userData.exhibitId = memory.memoryId;
    group.add(artifact);

    const light = new THREE.SpotLight(spec.style.glow, 14, 9, 0.5, 0.55, 1.6);
    light.position.set(x, 6.4, z);
    light.target = artifact;
    group.add(light);

    // Translucent cone faking a warm volumetric light shaft.
    const cone = new THREE.Mesh(
      track(new THREE.ConeGeometry(1.1, 5.4, 20, 1, true)),
      track(new THREE.MeshBasicMaterial({
        color: spec.style.glow,
        transparent: true,
        opacity: 0.05,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      }))
    );
    cone.position.set(x, 3.7, z);
    group.add(cone);

    exhibits.set(memory.memoryId, {
      memory,
      spec,
      artifact,
      pedestal,
      light,
      cone,
      baseEmissive: spec.style.emissiveIntensity,
      baseY: spec.hoverHeight,
      phase: angle,
      flyIn: 0,
      position: new THREE.Vector3(x, 0, z)
    });
  });

  // Light dust: one drifting particle cloud sized by recent event volume.
  const dustCount = Math.min(Math.max(eventCount * 6, 80), 600);
  const dustPositions = new Float32Array(dustCount * 3);
  for (let index = 0; index < dustCount; index += 1) {
    const radius = Math.sqrt(Math.random()) * (HALL_RADIUS + 1);
    const angle = Math.random() * Math.PI * 2;
    dustPositions[index * 3] = Math.cos(angle) * radius;
    dustPositions[index * 3 + 1] = 0.4 + Math.random() * 5.6;
    dustPositions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const dustGeometry = track(new THREE.BufferGeometry());
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, track(new THREE.PointsMaterial({
    color: DUST_COLOR,
    size: 0.05,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })));
  group.add(dust);

  scene.add(group);

  function eyeFor(exhibit) {
    const inward = exhibit.position.clone().normalize();
    return {
      position: exhibit.position.clone().addScaledVector(inward, -4.4).setY(2.2),
      target: new THREE.Vector3(exhibit.position.x, exhibit.baseY, exhibit.position.z)
    };
  }

  /** Flags an exhibit for the one-shot fly-in glow used on polling diffs. */
  function markFlyIn(memoryId) {
    const exhibit = exhibits.get(memoryId);
    if (exhibit) exhibit.flyIn = 1.4;
  }

  function update(t, dt) {
    for (const exhibit of exhibits.values()) {
      const { artifact, spec, light, cone } = exhibit;
      artifact.rotation.y += spec.spinSpeed * dt;
      artifact.position.y = exhibit.baseY + Math.sin(t * 0.9 + exhibit.phase) * spec.floatAmplitude;

      const motion = spec.style.motion;
      let level = 1;
      if (motion.type === "breath" || motion.type === "ghost") {
        level = motion.min + (motion.max - motion.min) * (0.5 + 0.5 * Math.sin(t * motion.speed * Math.PI + exhibit.phase));
      } else if (motion.type === "pulse") {
        level = motion.min + (motion.max - motion.min) * Math.abs(Math.sin(t * motion.speed * Math.PI));
      }
      let emissive = exhibit.baseEmissive * level;
      if (exhibit.flyIn > 0) {
        exhibit.flyIn = Math.max(0, exhibit.flyIn - dt);
        emissive += exhibit.flyIn * 2.2;
      }
      artifact.material.emissiveIntensity = emissive;
      light.intensity = 14 * (0.6 + 0.4 * level);
      cone.material.opacity = 0.035 + 0.03 * level;
    }
    if (checkpointSlab) {
      checkpointSlab.position.y = 1.25 + Math.sin(t * 0.7) * 0.05;
      checkpointSlab.rotation.y += 0.15 * dt;
    }
    dust.rotation.y += 0.008 * dt;
    dust.position.y = Math.sin(t * 0.12) * 0.25;
  }

  function dispose() {
    scene.remove(group);
    for (const resource of disposables) resource.dispose();
  }

  return { group, exhibits, checkpointSlab, dust, eyeFor, markFlyIn, update, dispose };
}
