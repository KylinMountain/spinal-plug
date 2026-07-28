// SPINAL-PLUG // MEMORY PALACE — 白色记忆实验室 dashboard
// 数据全部来自同源 Control Plane API(Bearer + ACL),不读取任何本地文件。

const TOKEN_KEY = "spinal-plug.console.token";
const LEGACY_TOKEN_KEY = "mind-palace.console.token";
const CAPSULE_BUDGET = 24_000;
const QUOTES = [
  "Second star to the right, and straight on till morning.",
  "连接、校准、确认,再行动。",
  "One memory core. Many capable hosts.",
  "接力比囤积更重要。"
];

const state = {
  token: localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || "",
  me: null,
  spaces: [],
  spaceId: localStorage.getItem("spinal-plug.palace.space") || "",
  overview: null,
  snapshot: null,
  devices: [],
  events: [],
  fidelityTrail: [],
  route: "overview",
  refreshTimer: null
};

const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]));

function timeAgo(iso) {
  if (!iso) return "—";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatTokens(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
}

// ---------- API ----------

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json", ...options.headers }
  });
  if (response.status === 401) {
    showLogin("令牌无效或已撤销,请重新输入。");
    throw new Error("unauthorized");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `请求失败(${response.status})`);
  }
  return response.json();
}

// ---------- 登录 ----------

function showLogin(message = "") {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("login-error").textContent = message;
  if (state.refreshTimer) clearInterval(state.refreshTimer);
}

function hideLogin() {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
}

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const token = $("token-input").value.trim();
  if (!token) {
    $("login-error").textContent = "请输入脊椎栓设备令牌(mpd_...)。";
    return;
  }
  state.token = token;
  localStorage.setItem(TOKEN_KEY, token);
  try {
    await boot();
  } catch (error) {
    if (error.message !== "unauthorized") {
      $("login-error").textContent = error.message;
    }
  }
});

// ---------- 启动与刷新 ----------

async function boot() {
  state.me = await api("/v1/me");
  hideLogin();
  $("user-name").textContent = state.me.deviceDisplayName || state.me.deviceId;
  $("user-avatar").textContent = (state.me.deviceDisplayName || state.me.deviceId || "?").slice(0, 1).toUpperCase();
  $("welcome").textContent = `Welcome back, ${state.me.deviceDisplayName || state.me.deviceId}`;
  state.spaces = (await api("/v1/spaces")).spaces;
  if (!state.spaceId || !state.spaces.some(space => space.spaceId === state.spaceId)) {
    state.spaceId = state.spaces[0]?.spaceId ?? "";
  }
  localStorage.setItem("spinal-plug.palace.space", state.spaceId);
  await refresh();
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refresh, 30_000);
}

async function refresh() {
  if (!state.spaceId) return;
  const [overview, snapshot, devices] = await Promise.all([
    api(`/v1/spaces/${encodeURIComponent(state.spaceId)}/overview`),
    api(`/v1/spaces/${encodeURIComponent(state.spaceId)}/snapshot`),
    api("/v1/devices")
  ]);
  state.overview = overview;
  state.snapshot = snapshot;
  state.devices = devices.devices;
  const space = state.spaces.find(item => item.spaceId === state.spaceId);
  $("space-name").textContent = space?.displayName ?? state.spaceId;
  $("space-quote").textContent = `“${QUOTES[Math.floor(Date.now() / 600_000) % QUOTES.length]}”`;
  renderFidelity();
  renderRoute();
  const eventCount = state.overview.activity.length;
  $("foot-events").textContent = `Event Ledger · ${eventCount} recent`;
  $("foot-health").textContent = state.overview.memory.disputes > 0 ? `${state.overview.memory.disputes} disputes` : "Healthy";
  $("sys-status-text").textContent = state.overview.memory.disputes > 0
    ? `${state.overview.memory.disputes} disputes need review`
    : "All Systems Operational";
}

// ---------- Fidelity 卡 ----------

function renderFidelity() {
  const fidelity = state.overview.fidelity;
  state.fidelityTrail.push(fidelity.percent);
  if (state.fidelityTrail.length > 24) state.fidelityTrail.shift();
  $("fidelity-pct").textContent = `${fidelity.percent}%`;
  $("fidelity-active").textContent = fidelity.activeReferences;
  $("fidelity-candidates").textContent = fidelity.pendingCandidates;
  $("fidelity-capsule").textContent = `${formatTokens(fidelity.capsuleUsage.used)} / ${formatTokens(fidelity.capsuleUsage.budget)} tokens`;
  $("fidelity-calibration").textContent = timeAgo(fidelity.lastCalibration);

  const canvas = $("fidelity-spark");
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  const trail = state.fidelityTrail.length > 1 ? state.fidelityTrail : [fidelity.percent, fidelity.percent];
  const min = Math.min(...trail, 0);
  const max = Math.max(...trail, 100);
  const span = Math.max(1, max - min);
  context.beginPath();
  trail.forEach((value, index) => {
    const x = (index / (trail.length - 1)) * canvas.width;
    const y = canvas.height - 4 - ((value - min) / span) * (canvas.height - 8);
    index === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
  });
  context.strokeStyle = "#7b68ee";
  context.lineWidth = 1.6;
  context.stroke();
}

// ---------- 路由 ----------

const ROUTES = ["overview", "spaces", "memory", "updates", "checkpoints", "incarnations", "ledger", "access", "settings"];

function currentRoute() {
  const route = location.hash.replace(/^#\//, "");
  return ROUTES.includes(route) ? route : "overview";
}

window.addEventListener("hashchange", renderRoute);

function renderRoute() {
  state.route = currentRoute();
  for (const item of document.querySelectorAll(".nav-item")) {
    item.classList.toggle("active", item.dataset.route === state.route);
  }
  for (const view of document.querySelectorAll(".view")) {
    view.classList.add("hidden");
  }
  $(`view-${state.route}`).classList.remove("hidden");
  if (!state.overview) return;
  ({
    overview: renderOverview,
    spaces: renderSpaces,
    memory: renderMemory,
    updates: renderUpdates,
    checkpoints: renderCheckpoints,
    incarnations: renderIncarnations,
    ledger: renderLedger,
    access: renderAccess,
    settings: renderSettings
  })[state.route]();
  const pending = state.overview.incomingUpdates.length;
  $("nav-updates-badge").textContent = pending > 0 ? String(pending) : "";
}

// ---------- 拓扑图 ----------

const TOPO_NODES = [
  { key: "active", title: "ACTIVE MEMORY", accent: "accent-violet", icon: "◈", angle: -115, sub: () => state.overview.memory.active === 0 ? "空记忆室" : "Up to date", value: () => state.overview.memory.active },
  { key: "candidates", title: "CANDIDATES", accent: "accent-amber", icon: "☐", angle: -65, sub: () => "待审阅记忆", value: () => state.overview.memory.candidates },
  { key: "checkpoints", title: "CHECKPOINTS", accent: "accent-cyan", icon: "☑", angle: -160, sub: () => "接力点", value: () => state.overview.checkpoints.length },
  { key: "disputes", title: "DISPUTES", accent: "accent-red", icon: "⚠", angle: -20, sub: () => "需要处理", value: () => state.overview.memory.disputes },
  { key: "tombstones", title: "TOMBSTONES", accent: "", icon: "▤", angle: 125, sub: () => "已删除记忆", value: () => state.overview.memory.tombstones },
  { key: "incarnations", title: "INCARNATIONS", accent: "accent-violet", icon: "⧉", angle: 90, sub: () => "已连接分身", value: () => state.overview.incarnations.length },
  { key: "uplinks", title: "SYNC UPLINKS", accent: "accent-cyan", icon: "⇡", angle: 40, sub: () => "连接正常", value: () => state.overview.incarnations.filter(item => item.status === "active").length }
];

function renderTopology() {
  const wrap = $("topology-wrap");
  const canvas = $("topology");
  const ratio = window.devicePixelRatio || 1;
  const width = wrap.clientWidth;
  const height = 430;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2 + 10;
  const radius = Math.min(width * 0.62, height * 0.92) * 0.5;

  // 轨道环
  for (const [ringRadius, alpha] of [[radius * 0.55, 0.5], [radius * 0.82, 0.35], [radius * 1.08, 0.22]]) {
    context.beginPath();
    context.ellipse(cx, cy, ringRadius, ringRadius * 0.92, 0, 0, Math.PI * 2);
    context.strokeStyle = `rgba(123, 104, 238, ${alpha * 0.35})`;
    context.setLineDash([3, 6]);
    context.lineWidth = 1;
    context.stroke();
  }
  context.setLineDash([]);

  // 核心辉光
  const glow = context.createRadialGradient(cx, cy, 4, cx, cy, radius * 0.5);
  glow.addColorStop(0, "rgba(123, 104, 238, .45)");
  glow.addColorStop(0.55, "rgba(123, 104, 238, .12)");
  glow.addColorStop(1, "rgba(123, 104, 238, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
  context.fill();

  // 核心晶体
  context.save();
  context.translate(cx, cy);
  const coreGradient = context.createLinearGradient(-40, -40, 40, 48);
  coreGradient.addColorStop(0, "#a89cf7");
  coreGradient.addColorStop(1, "#5b4bd6");
  context.fillStyle = coreGradient;
  context.shadowColor = "rgba(123, 104, 238, .55)";
  context.shadowBlur = 46;
  context.beginPath();
  context.moveTo(0, -46);
  context.lineTo(37, -18);
  context.lineTo(37, 24);
  context.lineTo(0, 48);
  context.lineTo(-37, 24);
  context.lineTo(-37, -18);
  context.closePath();
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "rgba(255,255,255,.35)";
  context.beginPath();
  context.moveTo(0, -46);
  context.lineTo(37, -18);
  context.lineTo(0, 3);
  context.lineTo(-37, -18);
  context.closePath();
  context.fill();
  context.restore();

  // 连线与节点锚点
  wrap.querySelectorAll(".topo-label,.topo-core-label").forEach(node => node.remove());
  for (const node of TOPO_NODES) {
    const angle = (node.angle * Math.PI) / 180;
    const nx = cx + Math.cos(angle) * radius * 1.45;
    const ny = cy + Math.sin(angle) * radius * 1.05;
    const gradient = context.createLinearGradient(cx, cy, nx, ny);
    gradient.addColorStop(0, "rgba(123, 104, 238, .55)");
    gradient.addColorStop(1, "rgba(34, 184, 166, .25)");
    context.strokeStyle = gradient;
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(cx, cy);
    context.lineTo(nx, ny);
    context.stroke();
    context.fillStyle = "rgba(123, 104, 238, .8)";
    context.beginPath();
    context.arc(nx, ny, 3, 0, Math.PI * 2);
    context.fill();

    const label = document.createElement("div");
    label.className = `topo-label ${node.accent}`;
    label.style.left = `${nx}px`;
    label.style.top = `${ny}px`;
    label.innerHTML = `
      <div class="tl-title">${node.icon} ${node.title}</div>
      <div class="tl-value">${esc(node.value())}</div>
      <div class="tl-sub">${esc(node.sub())}</div>`;
    wrap.appendChild(label);
  }
  const core = document.createElement("div");
  core.className = "topo-core-label";
  core.style.top = `${cy + 64}px`;
  core.innerHTML = `
    <div class="tc-name">MEMORY CORE</div>
    <div class="tc-sub">Active Projection · ${esc(state.overview.memory.active)} memories</div>`;
  wrap.appendChild(core);
}

// ---------- Overview ----------

function continuityRows() {
  const devicesById = new Map(state.devices.map(device => [device.deviceId, device]));
  const rows = state.overview.incarnations.map(incarnation => {
    const device = devicesById.get(incarnation.deviceId);
    return {
      label: `${incarnation.host} (${device?.displayName ?? incarnation.deviceId})`,
      link: incarnation.status === "active" ? ["ok", "Active"] : ["off", incarnation.status],
      projection: "Current",
      lastSync: timeAgo(incarnation.lastSync)
    };
  });
  for (const device of state.devices) {
    if (rows.some(row => row.label.includes(device.deviceId))) continue;
    rows.push({
      label: `${device.platform ?? "device"} (${device.displayName})`,
      link: device.status === "active" ? ["warn", "Registered"] : ["off", device.status],
      projection: "N/A",
      lastSync: "—"
    });
  }
  return rows;
}

function activityIcon(eventType) {
  if (eventType.includes("candidate")) return ["☐", "amber"];
  if (eventType.includes("deleted") || eventType.includes("tombstone")) return ["▤", ""];
  if (eventType.includes("checkpoint")) return ["☑", "cyan"];
  if (eventType.includes("runtime") || eventType.includes("incarn")) return ["⧉", "cyan"];
  return ["◈", ""];
}

function activityTitle(eventType) {
  return eventType.replace(/^memory\./, "Memory ").replace(/^runtime\./, "Runtime ").replace(/\./g, " ");
}

function renderOverview() {
  const overview = state.overview;
  const latestCheckpoint = overview.checkpoints[0];
  const currentIncarnation = overview.incarnations.find(item => item.status === "active") ?? overview.incarnations[0];
  const capsule = overview.fidelity.capsuleUsage;

  $("view-overview").innerHTML = `
    <div class="overview-grid">
      <div class="panel topology-wrap" id="topology-wrap">
        <canvas id="topology"></canvas>
      </div>
      <div class="side-stack">
        <div class="panel">
          <div class="panel-title">Current Incarnation <span class="status-pill ok">Linked</span></div>
          ${currentIncarnation ? `
          <dl class="kv">
            <dt>Host</dt><dd>${esc(currentIncarnation.host)}</dd>
            <dt>Device</dt><dd>${esc(currentIncarnation.deviceId)}</dd>
            <dt>Project Space</dt><dd class="violet">${esc($("space-name").textContent)}</dd>
            <dt>Link Status</dt><dd>${esc(currentIncarnation.status)}</dd>
            <dt>Projection</dt><dd>${esc(currentIncarnation.projection)}</dd>
            <dt>Capsule Usage</dt><dd>${formatTokens(capsule.used)} / ${formatTokens(capsule.budget)} tokens</dd>
            <div class="usage-bar"><i style="width:${Math.min(100, (capsule.used / CAPSULE_BUDGET) * 100)}%"></i></div>
            <dt>Last Sync</dt><dd>${timeAgo(currentIncarnation.lastSync)}</dd>
          </dl>` : `<div class="empty">尚无 Incarnation — 由宿主 SessionStart 自动创建</div>`}
        </div>
        <div class="panel">
          <div class="panel-title">Recent Activity <a href="#/ledger">View all</a></div>
          <div class="activity">
            ${overview.activity.slice(0, 6).map(event => {
              const [icon, tone] = activityIcon(event.eventType);
              return `
              <div class="activity-item">
                <div class="activity-ico ${tone}">${icon}</div>
                <div>
                  <div class="activity-title">${esc(activityTitle(event.eventType))}</div>
                  <div class="activity-sub">${esc(event.title ?? "")} · ${esc(event.host)}</div>
                </div>
                <span class="activity-time">${timeAgo(event.createdAt)}</span>
              </div>`;
            }).join("") || `<div class="empty">暂无事件</div>`}
          </div>
        </div>
      </div>
    </div>
    <div class="overview-bottom">
      <div class="panel">
        <div class="panel-title">Incoming Updates <a href="#/updates">View all</a></div>
        ${renderUpdateItems(overview.incomingUpdates.slice(0, 3))}
      </div>
      <div class="panel">
        <div class="panel-title">Current Checkpoint ${latestCheckpoint ? `<span class="tag">${timeAgo(latestCheckpoint.updatedAt)}</span>` : ""}</div>
        ${latestCheckpoint ? renderCheckpointBody(latestCheckpoint) : `<div class="empty">暂无 Checkpoint — 交接工作时由宿主创建</div>`}
      </div>
      <div class="panel">
        <div class="panel-title">Continuity Status <a href="#/incarnations">View all</a></div>
        <table class="data">
          <thead><tr><th>Host / Session</th><th>Link</th><th>Projection</th><th>Last Sync</th></tr></thead>
          <tbody>
            ${continuityRows().map(row => `
              <tr>
                <td>${esc(row.label)}</td>
                <td><span class="status-pill ${row.link[0]}">${row.link[1]}</span></td>
                <td>${esc(row.projection)}</td>
                <td>${esc(row.lastSync)}</td>
              </tr>`).join("") || `<tr><td colspan="4" class="empty">暂无分身</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
  renderTopology();
}

function renderCheckpointBody(checkpoint) {
  const payload = checkpoint.payload ?? checkpoint;
  return `
    <dl class="kv" style="text-align:left">
      <dt>Goal</dt><dd style="text-align:left;font-family:inherit">${esc(payload.title ?? "—")}</dd>
      <dt>Status</dt><dd style="text-align:left"><span class="status-pill ${payload.status === "active" ? "ok" : "off"}">${esc(payload.status ?? "active")}</span></dd>
      <dt>Completed</dt><dd style="text-align:left;font-family:inherit">${(payload.completed ?? []).length} 项</dd>
      <dt>Next Step</dt><dd style="text-align:left;font-family:inherit">${esc(payload.nextAction ?? "—")}</dd>
      <dt>Blockers</dt><dd style="text-align:left;font-family:inherit">${(payload.blockers ?? []).length > 0 ? esc(payload.blockers.join(";")) : "无"}</dd>
    </dl>`;
}

function renderUpdateItems(updates) {
  return updates.map((memory, index) => `
    <div class="update-item">
      <div class="activity-ico amber">☐</div>
      <div style="flex:1;min-width:0">
        <div class="update-title">${esc(memory.title)}</div>
        <div class="update-meta">来自 ${esc(memory.origin ?? "agent")} · <span class="tag">${esc(memory.kind)}</span> <span class="tag amber">置信 ${(memory.confidence ?? 0).toFixed(2)}</span></div>
      </div>
      <button class="btn" data-preview="${index}">Preview</button>
      <button class="btn primary" data-apply="${esc(memory.memoryId)}">Apply</button>
    </div>`).join("") || `<div class="empty">没有待处理的更新</div>`;
}

// ---------- 其他视图 ----------

function renderSpaces() {
  $("view-spaces").innerHTML = `
    <div class="panel">
      <div class="panel-title">Project Spaces</div>
      <table class="data">
        <thead><tr><th>Space</th><th>ID</th><th>Type</th><th>Role</th><th></th></tr></thead>
        <tbody>
          ${state.spaces.map(space => `
            <tr>
              <td>${esc(space.displayName)}</td>
              <td style="font-family:var(--mono);font-size:11px">${esc(space.spaceId)}</td>
              <td>${esc(space.type)}</td>
              <td><span class="tag">${esc(space.role)}</span></td>
              <td>${space.spaceId === state.spaceId ? '<span class="status-pill ok">Current</span>' : `<button class="btn" data-switch="${esc(space.spaceId)}">切换</button>`}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderMemory() {
  const memories = state.snapshot.memories;
  $("view-memory").innerHTML = `
    <div class="panel">
      <div class="panel-title">Memory Core · Active Projection (${memories.length})</div>
      <table class="data">
        <thead><tr><th>Kind</th><th>Title</th><th>Statement</th><th>Key</th><th>置信</th></tr></thead>
        <tbody>
          ${memories.map(memory => `
            <tr>
              <td><span class="tag">${esc(memory.kind)}</span></td>
              <td>${esc(memory.title)}</td>
              <td style="max-width:420px">${esc(memory.statement)}</td>
              <td style="font-family:var(--mono);font-size:11px">${esc(memory.semanticKey ?? "—")}</td>
              <td>${(memory.confidence ?? 0).toFixed(2)}</td>
            </tr>`).join("") || `<tr><td colspan="5" class="empty">空记忆室 — 宿主会在会话中生成首批记忆</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

function renderUpdates() {
  $("view-updates").innerHTML = `
    <div class="panel">
      <div class="panel-title">Incoming Updates · FETCH → PREVIEW → APPLY (${state.overview.incomingUpdates.length})</div>
      ${renderUpdateItems(state.overview.incomingUpdates)}
    </div>`;
}

function renderCheckpoints() {
  $("view-checkpoints").innerHTML = `
    <div class="panel">
      <div class="panel-title">Checkpoints (${state.overview.checkpoints.length})</div>
      ${state.overview.checkpoints.map(checkpoint => `
        <div class="update-item" style="align-items:flex-start">
          <div class="activity-ico cyan">☑</div>
          <div style="flex:1">${renderCheckpointBody(checkpoint)}</div>
          <span class="activity-time">${timeAgo(checkpoint.updatedAt)}</span>
        </div>`).join("") || `<div class="empty">暂无 Checkpoint</div>`}
    </div>`;
}

function renderIncarnations() {
  $("view-incarnations").innerHTML = `
    <div class="panel">
      <div class="panel-title">Incarnations · Continuity Matrix</div>
      <table class="data">
        <thead><tr><th>Host / Session</th><th>Link Status</th><th>Projection</th><th>Last Sync</th></tr></thead>
        <tbody>
          ${continuityRows().map(row => `
            <tr>
              <td>${esc(row.label)}</td>
              <td><span class="status-pill ${row.link[0]}">${row.link[1]}</span></td>
              <td>${esc(row.projection)}</td>
              <td>${esc(row.lastSync)}</td>
            </tr>`).join("") || `<tr><td colspan="4" class="empty">暂无分身</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

function renderLedger() {
  $("view-ledger").innerHTML = `
    <div class="panel">
      <div class="panel-title">Event Ledger(近期 ${state.overview.activity.length} 条 · authoritative source of truth)</div>
      <div class="activity">
        ${state.overview.activity.map(event => {
          const [icon, tone] = activityIcon(event.eventType);
          return `
          <div class="activity-item">
            <div class="activity-ico ${tone}">${icon}</div>
            <div>
              <div class="activity-title">${esc(activityTitle(event.eventType))}</div>
              <div class="activity-sub">${esc(event.title ?? event.eventId)} · ${esc(event.host)} / ${esc(event.deviceId)}</div>
            </div>
            <span class="activity-time">${timeAgo(event.createdAt)}</span>
          </div>`;
        }).join("") || `<div class="empty">暂无事件</div>`}
      </div>
    </div>`;
}

function renderAccess() {
  $("view-access").innerHTML = `
    <div class="panel">
      <div class="panel-title">Access Control · Devices (${state.devices.length})</div>
      <table class="data">
        <thead><tr><th>Device</th><th>ID</th><th>Platform</th><th>Status</th><th>Registered</th></tr></thead>
        <tbody>
          ${state.devices.map(device => `
            <tr>
              <td>${esc(device.displayName)}</td>
              <td style="font-family:var(--mono);font-size:11px">${esc(device.deviceId)}</td>
              <td>${esc(device.platform ?? "—")}</td>
              <td><span class="status-pill ${device.status === "active" ? "ok" : "bad"}">${esc(device.status)}</span></td>
              <td>${timeAgo(device.createdAt)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderSettings() {
  $("view-settings").innerHTML = `
    <div class="panel">
      <div class="panel-title">System Settings</div>
      <dl class="kv">
        <dt>Device</dt><dd>${esc(state.me.deviceDisplayName ?? state.me.deviceId)}</dd>
        <dt>Account</dt><dd style="font-family:var(--mono)">${esc(state.me.accountId)}</dd>
        <dt>Current Space</dt><dd class="violet">${esc(state.spaceId)}</dd>
        <dt>Capsule Budget</dt><dd>${formatTokens(CAPSULE_BUDGET)} tokens</dd>
        <dt>Refresh Interval</dt><dd>30s</dd>
      </dl>
      <div style="margin-top:16px">
        <button class="btn" id="logout">更换设备令牌</button>
      </div>
    </div>`;
  $("logout").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    state.token = "";
    showLogin();
  });
}

// ---------- 预览与 Apply ----------

document.addEventListener("click", async event => {
  const previewIndex = event.target.dataset?.preview;
  const applyId = event.target.dataset?.apply;
  const switchSpace = event.target.dataset?.switch;
  if (previewIndex !== undefined) {
    const memory = state.overview.incomingUpdates[Number(previewIndex)];
    $("modal-body").innerHTML = `
      <h3>${esc(memory.title)}</h3>
      <span class="tag">${esc(memory.kind)}</span> <span class="tag amber">置信 ${(memory.confidence ?? 0).toFixed(2)}</span>
      <div class="modal-kv">
        <dt>来源</dt><dd>${esc(memory.origin ?? "agent")}</dd>
        <dt>Semantic Key</dt><dd style="font-family:var(--mono)">${esc(memory.semanticKey ?? "—")}</dd>
        <dt>Memory ID</dt><dd style="font-family:var(--mono);font-size:11px">${esc(memory.memoryId)}</dd>
      </div>
      <div class="modal-statement">${esc(memory.statement)}</div>
      ${memory.why ? `<div class="modal-kv"><dt>Why</dt><dd>${esc(memory.why)}</dd></div>` : ""}
      ${memory.howToApply ? `<div class="modal-kv"><dt>How to apply</dt><dd>${esc(memory.howToApply)}</dd></div>` : ""}
      <div style="margin-top:16px;text-align:right">
        <button class="btn primary" data-apply="${esc(memory.memoryId)}">Apply 到当前投影</button>
      </div>`;
    $("modal").classList.remove("hidden");
    return;
  }
  if (applyId) {
    const button = event.target;
    button.disabled = true;
    button.textContent = "Applying…";
    try {
      await applyCandidate(applyId);
      $("modal").classList.add("hidden");
      await refresh();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Apply";
      alert(error.message);
    }
    return;
  }
  if (switchSpace) {
    state.spaceId = switchSpace;
    localStorage.setItem("spinal-plug.palace.space", switchSpace);
    location.hash = "#/overview";
    await refresh();
  }
});

$("modal-close").addEventListener("click", () => $("modal").classList.add("hidden"));
$("modal").addEventListener("click", event => {
  if (event.target === $("modal")) $("modal").classList.add("hidden");
});

async function applyCandidate(memoryId) {
  const memory = state.overview.incomingUpdates.find(item => item.memoryId === memoryId);
  if (!memory) throw new Error("候选已不存在,请刷新。");
  const eventId = crypto.randomUUID();
  await api("/v1/events:push", {
    method: "POST",
    body: JSON.stringify({
      spaceId: state.spaceId,
      deviceId: state.me.deviceId,
      events: [{
        schemaVersion: 1,
        eventId,
        eventType: "memory.promoted",
        eventVersion: 1,
        accountId: state.me.accountId,
        personaId: "persona_default",
        spaceId: state.spaceId,
        actor: {
          deviceId: state.me.deviceId,
          agentInstallationId: "palace-dashboard",
          host: "palace",
          sessionId: "dashboard",
          adapterVersion: "0.3.0"
        },
        causality: { parentEventIds: [] },
        runtimeContext: {},
        payload: {
          ...memory,
          status: "active",
          confidence: Math.max(memory.confidence ?? 0, 0.92)
        },
        createdAt: new Date().toISOString(),
        idempotencyKey: eventId
      }]
    })
  });
}

// ---------- 启动 ----------

window.addEventListener("resize", () => {
  if (state.route === "overview" && state.overview) renderTopology();
});

if (state.token) {
  boot().catch(error => {
    if (error.message !== "unauthorized") showLogin(error.message);
  });
} else {
  showLogin();
}
