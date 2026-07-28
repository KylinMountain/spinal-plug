import * as THREE from "three";

const DWELL_SECONDS = 4;
const IDLE_RESUME_SECONDS = 15;
const BLEND_SECONDS = 1.8;
const DRAG_THRESHOLD_PX = 6;

function smoothstep(x) {
  return x * x * (3 - 2 * x);
}

/**
 * Auto-tour along a closed Catmull-Rom path through each exhibit's eye
 * position, dwelling a few seconds at every stop. Any drag or wheel input
 * hands the camera to the user (drag to orbit, wheel to dolly); after
 * IDLE_RESUME_SECONDS without input the tour blends back in.
 */
export function createTour({ camera, dom, onCaption = () => {}, onTakeover = () => {}, onResume = () => {} }) {
  let stops = [];
  let curve = null;
  let segments = [];
  let mode = "tour"; // "tour" | "blend" | "user"
  let phase = "dwell"; // within tour: "travel" | "dwell"
  let segmentIndex = 0;
  let segmentTime = 0;
  let blendTime = 0;
  const blendFromPosition = new THREE.Vector3();
  const blendFromTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3(0, 1.4, 0);
  const orbit = { pivot: new THREE.Vector3(0, 1.4, 0), yaw: 0, pitch: 0.25, radius: 9 };
  let lastActivity = performance.now();
  let drag = null;
  let lastPointer = null;

  function setStops(nextStops) {
    stops = nextStops;
    curve = stops.length >= 2
      ? new THREE.CatmullRomCurve3(stops.map(stop => stop.position), true, "centripetal", 0.6)
      : null;
    segments = stops.map((stop, index) => ({
      dwell: DWELL_SECONDS,
      travel: Math.min(Math.max(stop.position.distanceTo(stops[(index + 1) % stops.length].position) * 0.28, 2.2), 6)
    }));
    segmentIndex = 0;
    segmentTime = 0;
    phase = "dwell";
    if (mode !== "user" && stops.length) {
      camera.position.copy(stops[0].position);
      lookTarget.copy(stops[0].target);
      camera.lookAt(lookTarget);
      onCaption(stops[0].caption);
    }
  }

  function takeover() {
    if (mode === "user") return;
    mode = "user";
    orbit.pivot.copy(lookTarget);
    const offset = camera.position.clone().sub(orbit.pivot);
    orbit.radius = Math.min(Math.max(offset.length(), 2), 30);
    orbit.yaw = Math.atan2(offset.x, offset.z);
    orbit.pitch = Math.asin(THREE.MathUtils.clamp(offset.y / Math.max(offset.length(), 0.001), -1, 1));
    onTakeover();
  }

  function resume() {
    if (!stops.length || mode !== "user") return;
    mode = "blend";
    blendTime = 0;
    blendFromPosition.copy(camera.position);
    blendFromTarget.copy(lookTarget);
    // Re-enter at the stop nearest to the current camera position.
    let nearest = 0;
    let nearestDistance = Infinity;
    stops.forEach((stop, index) => {
      const distance = stop.position.distanceTo(camera.position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    });
    segmentIndex = nearest;
    phase = "dwell";
    segmentTime = 0;
    onResume();
  }

  function applyOrbit() {
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch, -0.4, 1.25);
    orbit.radius = THREE.MathUtils.clamp(orbit.radius, 2, 30);
    const cosPitch = Math.cos(orbit.pitch);
    camera.position.set(
      orbit.pivot.x + orbit.radius * cosPitch * Math.sin(orbit.yaw),
      orbit.pivot.y + orbit.radius * Math.sin(orbit.pitch),
      orbit.pivot.z + orbit.radius * cosPitch * Math.cos(orbit.yaw)
    );
    camera.lookAt(orbit.pivot);
  }

  function update(dt) {
    if (mode === "user") {
      applyOrbit();
      if ((performance.now() - lastActivity) / 1000 > IDLE_RESUME_SECONDS) resume();
      return;
    }
    if (!stops.length) return;

    if (mode === "blend") {
      blendTime += dt;
      const k = smoothstep(Math.min(blendTime / BLEND_SECONDS, 1));
      camera.position.lerpVectors(blendFromPosition, stops[segmentIndex].position, k);
      lookTarget.lerpVectors(blendFromTarget, stops[segmentIndex].target, k);
      camera.lookAt(lookTarget);
      if (blendTime >= BLEND_SECONDS) {
        mode = "tour";
        onCaption(stops[segmentIndex].caption);
      }
      return;
    }

    // Tour mode.
    if (stops.length === 1 || !curve) {
      camera.position.copy(stops[0].position);
      lookTarget.lerp(stops[0].target, 1 - Math.exp(-4 * dt));
      camera.lookAt(lookTarget);
      return;
    }
    segmentTime += dt;
    const segment = segments[segmentIndex];
    if (phase === "travel") {
      const u0 = segmentIndex / stops.length;
      let span = ((segmentIndex + 1) % stops.length) / stops.length - u0;
      if (span <= 0) span += 1;
      const k = smoothstep(Math.min(segmentTime / segment.travel, 1));
      camera.position.copy(curve.getPoint((u0 + span * k) % 1));
      const next = stops[(segmentIndex + 1) % stops.length];
      lookTarget.lerp(next.target, 1 - Math.exp(-3 * dt));
      if (segmentTime >= segment.travel) {
        segmentIndex = (segmentIndex + 1) % stops.length;
        phase = "dwell";
        segmentTime = 0;
        onCaption(stops[segmentIndex].caption);
      }
    } else {
      camera.position.copy(stops[segmentIndex].position);
      lookTarget.lerp(stops[segmentIndex].target, 1 - Math.exp(-4 * dt));
      if (segmentTime >= segment.dwell) {
        phase = "travel";
        segmentTime = 0;
      }
    }
    camera.lookAt(lookTarget);
  }

  function onPointerDown(event) {
    lastActivity = performance.now();
    drag = { x: event.clientX, y: event.clientY, active: false };
    lastPointer = { x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event) {
    if (!drag || !lastPointer) return;
    lastActivity = performance.now();
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > DRAG_THRESHOLD_PX) {
        drag.active = true;
        takeover();
      }
    }
    if (drag.active && mode === "user") {
      orbit.yaw -= (event.clientX - lastPointer.x) * 0.005;
      orbit.pitch += (event.clientY - lastPointer.y) * 0.005;
    }
    lastPointer = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp() {
    lastActivity = performance.now();
    drag = null;
    lastPointer = null;
  }

  function onWheel(event) {
    event.preventDefault();
    lastActivity = performance.now();
    takeover();
    orbit.radius *= 1 + event.deltaY * 0.001;
  }

  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointermove", onPointerMove);
  dom.addEventListener("pointerup", onPointerUp);
  dom.addEventListener("pointercancel", onPointerUp);
  dom.addEventListener("wheel", onWheel, { passive: false });

  return {
    setStops,
    update,
    resume,
    takeover,
    get mode() { return mode; },
    dispose() {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointercancel", onPointerUp);
      dom.removeEventListener("wheel", onWheel);
    }
  };
}
