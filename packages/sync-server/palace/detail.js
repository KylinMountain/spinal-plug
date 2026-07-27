/** DOM detail panel for clicked exhibits and the checkpoint reading table. */

export function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[char]));
}

function metaRow(label, value) {
  return value ? `<div class="detail-meta"><span>${esc(label)}</span>${esc(value)}</div>` : "";
}

function listBlock(title, items) {
  if (!items?.length) return "";
  return `<h4>${esc(title)}</h4><ul>${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

export function createDetailPanel(root) {
  root.innerHTML = '<button type="button" class="detail-close" aria-label="关闭">×</button><div class="detail-body"></div>';
  const body = root.querySelector(".detail-body");
  root.querySelector(".detail-close").addEventListener("click", hide);

  function showMemory(memory) {
    body.innerHTML = `
      <div class="detail-tag ${esc(memory.status)}">${esc(memory.status)}</div>
      <h3>${esc(memory.title)}</h3>
      <p class="detail-statement">${esc(memory.statement)}</p>
      ${memory.why ? `<h4>缘由</h4><p>${esc(memory.why)}</p>` : ""}
      ${memory.howToApply ? `<h4>如何应用</h4><p>${esc(memory.howToApply)}</p>` : ""}
      ${listBlock("引用", memory.references)}
      ${metaRow("kind", memory.kind)}
      ${metaRow("origin", memory.origin || "unknown")}
      ${metaRow("confidence", typeof memory.confidence === "number" ? memory.confidence.toFixed(2) : "")}
      ${metaRow("updated", memory.updatedAt)}
    `;
    root.classList.add("open");
  }

  function showCheckpoint(checkpoint) {
    body.innerHTML = `
      <div class="detail-tag checkpoint">checkpoint</div>
      <h3>${esc(checkpoint.title)}</h3>
      ${checkpoint.summary ? `<p class="detail-statement">${esc(checkpoint.summary)}</p>` : ""}
      ${listBlock("待办", checkpoint.openTasks)}
      ${listBlock("阻塞", checkpoint.blockers)}
      ${checkpoint.nextAction ? `<h4>下一步</h4><p>${esc(checkpoint.nextAction)}</p>` : ""}
      ${metaRow("branch", checkpoint.branchId || "default")}
      ${metaRow("updated", checkpoint.updatedAt)}
    `;
    root.classList.add("open");
  }

  function hide() {
    root.classList.remove("open");
  }

  return { showMemory, showCheckpoint, hide };
}
