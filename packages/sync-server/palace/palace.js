import * as THREE from "three";
import { createStage, buildGallery } from "./scene.js";
import { createTour } from "./tour.js";
import { createDetailPanel, esc } from "./detail.js";
import { diffMemories } from "./exhibits.js";

// Shared with the control console so one login serves both pages; the
// pre-rename key is still honored as a fallback.
const TOKEN_KEY = "spinal-plug.console.token";
const LEGACY_TOKEN_KEY = "mind-palace.console.token";
const POLL_MS = 30_000;

const $ = id => document.getElementById(id);

const state = {
  token: localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || "",
  spaces: [],
  spaceId: null,
  stage: null,
  gallery: null,
  tour: null,
  panel: null,
  memories: [],
  checkpoint: null,
  eventCount: 0,
  pollTimer: null,
  clock: new THREE.Clock()
};

function setStatus(text, tone) {
  $("status-text").textContent = text;
  $("status-dot").className = `dot ${tone || ""}`;
}

function showError(message) {
  $("error").textContent = message;
  $("error").classList.remove("hidden");
}

function clearError() {
  $("error").classList.add("hidden");
}

function caption(text) {
  const node = $("caption");
  node.textContent = text;
  node.classList.add("visible");
}

function fade(show) {
  $("fade").classList.toggle("visible", show);
}

async function api(path) {
  const response = await fetch(path, { headers: { authorization: `Bearer ${state.token}` } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

/**
 * Snapshot fields: memories (active), candidates, superseded, deleted are
 * memory lists; disputes are dispute records, so memories referenced by an
 * open dispute get their display status overridden to "disputed".
 */
function collectMemories(snapshot) {
  const disputedIds = new Set(
    (snapshot.disputes || [])
      .filter(dispute => dispute.status === "open")
      .flatMap(dispute => dispute.memoryIds || [])
  );
  const all = [
    ...(snapshot.memories || []),
    ...(snapshot.candidates || []),
    ...(snapshot.superseded || []),
    ...(snapshot.deleted || [])
  ];
  return all.map(memory => disputedIds.has(memory.memoryId) ? { ...memory, status: "disputed" } : memory);
}

function renderSpaceSelect() {
  const select = $("space-select");
  select.innerHTML = state.spaces.map(space =>
    `<option value="${esc(space.spaceId)}"${space.spaceId === state.spaceId ? " selected" : ""}>${esc(space.displayName)}</option>`
  ).join("");
  select.classList.toggle("hidden", state.spaces.length === 0);
}

function rebuildStops() {
  const stops = [];
  if (state.checkpoint) {
    stops.push({
      position: new THREE.Vector3(0, 2.2, 4.6),
      target: new THREE.Vector3(0, 1.25, 0),
      caption: `阅览桌 · ${state.checkpoint.title}`
    });
  }
  for (const exhibit of state.gallery.exhibits.values()) {
    const eye = state.gallery.eyeFor(exhibit);
    stops.push({ ...eye, caption: exhibit.memory.title });
  }
  state.tour.setStops(stops);
}

function buildSpace(snapshot, eventCount) {
  state.memories = collectMemories(snapshot);
  state.checkpoint = (snapshot.checkpoints || [])[0] ?? null;
  state.eventCount = eventCount;
  if (state.gallery) state.gallery.dispose();
  state.gallery = buildGallery(state.stage.scene, {
    memories: state.memories,
    checkpoint: state.checkpoint,
    eventCount
  });
  state.panel.hide();
  rebuildStops();
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(poll, POLL_MS);
}

async function poll() {
  if (!state.spaceId) return;
  try {
    const snapshot = await api(`/v1/spaces/${encodeURIComponent(state.spaceId)}/snapshot`);
    const next = collectMemories(snapshot);
    const { added, statusChanged } = diffMemories(state.memories, next);
    const removed = state.memories.filter(memory =>
      !next.some(item => item.memoryId === memory.memoryId)
    ).map(memory => memory.memoryId);
    const nextCheckpoint = (snapshot.checkpoints || [])[0] ?? null;
    const checkpointChanged =
      (nextCheckpoint?.checkpointId ?? null) !== (state.checkpoint?.checkpointId ?? null) ||
      nextCheckpoint?.updatedAt !== state.checkpoint?.updatedAt;

    if (added.length || statusChanged.length || removed.length || checkpointChanged) {
      buildSpace(snapshot, state.eventCount);
      for (const id of [...added, ...statusChanged]) state.gallery.markFlyIn(id);
      caption(`链路同步 · ${added.length} 件新藏品 / ${statusChanged.length} 件状态变更`);
    }
    setStatus("NEURAL LINK LOCKED", "ok");
  } catch {
    // Keep the previous hall standing when the link drops.
    setStatus("LINK INTERRUPTION", "bad");
  }
  schedulePoll();
}

async function loadSpace() {
  if (!state.spaceId || !state.stage) return;
  try {
    fade(true);
    const [snapshot, timeline] = await Promise.all([
      api(`/v1/spaces/${encodeURIComponent(state.spaceId)}/snapshot`),
      api(`/v1/spaces/${encodeURIComponent(state.spaceId)}/events?limit=100`)
    ]);
    buildSpace(snapshot, (timeline.events || []).length);
    clearError();
    setStatus("NEURAL LINK LOCKED", "ok");
    schedulePoll();
  } catch (error) {
    showError(error.message);
    setStatus("LINK INTERRUPTION", "bad");
  } finally {
    fade(false);
  }
}

async function connect() {
  try {
    state.token = $("token").value.trim();
    if (!state.token) throw new Error("请输入脊椎栓设备令牌（mpd_...）。");
    localStorage.setItem(TOKEN_KEY, state.token);
    clearError();
    setStatus("LOCKING SPINAL LINK", "");
    const result = await api("/v1/spaces");
    state.spaces = result.spaces || [];
    $("auth-overlay").classList.add("hidden");
    if (!state.spaces.length) {
      setStatus("NO MEMORY CHAMBER ACCESS", "bad");
      return;
    }
    state.spaceId = state.spaces.some(space => space.spaceId === state.spaceId)
      ? state.spaceId
      : state.spaces[0].spaceId;
    renderSpaceSelect();
    await loadSpace();
  } catch (error) {
    showError(error.message);
    setStatus("AUTHENTICATION FAILED", "bad");
  }
}

function bindPicking(dom) {
  const raycaster = new THREE.Raycaster();
  let downAt = null;
  dom.addEventListener("pointerdown", event => {
    downAt = { x: event.clientX, y: event.clientY };
  });
  dom.addEventListener("pointerup", event => {
    const moved = downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6;
    downAt = null;
    if (moved || !state.gallery) return;
    const rect = dom.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, state.stage.camera);
    const hits = raycaster.intersectObjects(state.gallery.group.children, true);
    for (const hit of hits) {
      const exhibitId = hit.object.userData.exhibitId;
      if (exhibitId) {
        const exhibit = state.gallery.exhibits.get(exhibitId);
        if (exhibit) state.panel.showMemory(exhibit.memory);
        return;
      }
      if (hit.object.userData.checkpoint && state.checkpoint) {
        state.panel.showCheckpoint(state.checkpoint);
        return;
      }
    }
    state.panel.hide();
  });
}

function animate() {
  const dt = Math.min(state.clock.getDelta(), 0.1);
  const t = state.clock.elapsedTime;
  state.tour.update(dt);
  if (state.gallery) state.gallery.update(t, dt);
  state.stage.render();
}

function init() {
  state.panel = createDetailPanel($("detail"));
  try {
    state.stage = createStage($("view"));
  } catch {
    $("webgl-fallback").classList.remove("hidden");
    return;
  }
  state.tour = createTour({
    camera: state.stage.camera,
    dom: state.stage.renderer.domElement,
    onCaption: caption,
    onTakeover: () => {
      $("resume-tour").classList.remove("hidden");
      caption("巡展已暂停 · 拖拽环视，滚轮推拉");
    },
    onResume: () => $("resume-tour").classList.add("hidden")
  });
  bindPicking(state.stage.renderer.domElement);
  state.stage.renderer.setAnimationLoop(animate);
  $("resume-tour").addEventListener("click", () => state.tour.resume());
  $("space-select").addEventListener("change", event => {
    state.spaceId = event.target.value;
    loadSpace();
  });
  if (state.token) {
    $("token").value = state.token;
    connect();
  }
}

$("auth-form").addEventListener("submit", event => {
  event.preventDefault();
  connect();
});
init();
