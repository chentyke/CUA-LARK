const state = {
  mode: "instruction",
  activeJobId: null,
  pollTimer: null
};

const els = {
  configStrip: document.querySelector("#configStrip"),
  runForm: document.querySelector("#runForm"),
  dryRun: document.querySelector("#dryRun"),
  instruction: document.querySelector("#instruction"),
  caseId: document.querySelector("#caseId"),
  suite: document.querySelector("#suite"),
  activeJob: document.querySelector("#activeJob"),
  logBox: document.querySelector("#logBox"),
  runs: document.querySelector("#runs"),
  doctorButton: document.querySelector("#doctorButton"),
  refreshJobs: document.querySelector("#refreshJobs")
};

document.querySelectorAll(".mode-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll(".mode-tabs button").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelector(".instruction-field").classList.toggle("hidden", state.mode !== "instruction");
    document.querySelector(".case-field").classList.toggle("hidden", state.mode !== "case");
    document.querySelector(".suite-field").classList.toggle("hidden", state.mode !== "suite");
  });
});

els.runForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    mode: state.mode,
    dryRun: els.dryRun.checked,
    instruction: els.instruction.value,
    caseId: els.caseId.value,
    suite: els.suite.value
  };
  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    showError(data.error || "Failed to start job");
    return;
  }
  state.activeJobId = data.id;
  pollJob();
});

els.doctorButton.addEventListener("click", async () => {
  const data = await getJson("/api/doctor");
  els.logBox.textContent = data.text;
});

els.refreshJobs.addEventListener("click", loadJobs);

await init();

async function init() {
  const [config, cases] = await Promise.all([getJson("/api/config"), getJson("/api/cases")]);
  els.configStrip.innerHTML = `
    <span><strong>${escapeHtml(config.larkAppName)}</strong></span>
    <span> · ${escapeHtml(config.model || "no model")}</span>
    <span> · key ${config.hasApiKey ? "ready" : "missing"}</span>
  `;
  els.caseId.innerHTML = cases.cases
    .map((testCase) => `<option value="${escapeHtml(testCase.id)}">${escapeHtml(testCase.id)} - ${escapeHtml(testCase.description)}</option>`)
    .join("");
  await loadJobs();
}

async function pollJob() {
  if (!state.activeJobId) return;
  clearTimeout(state.pollTimer);
  const job = await getJson(`/api/jobs/${state.activeJobId}`);
  renderActiveJob(job);
  await loadJobs();
  if (job.status === "queued" || job.status === "running") {
    state.pollTimer = setTimeout(pollJob, 1800);
  }
}

async function loadJobs() {
  const data = await getJson("/api/jobs");
  els.runs.innerHTML = data.jobs.length
    ? data.jobs.map(renderJobRow).join("")
    : `<div class="muted">No runs yet</div>`;
}

function renderActiveJob(job) {
  els.activeJob.innerHTML = `
    <div class="badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</div>
    <h3>${escapeHtml(job.title)}</h3>
    <p class="muted">${escapeHtml(job.id)}</p>
    ${job.reportUrl ? `<a href="${job.reportUrl}" target="_blank" rel="noreferrer">Open HTML report</a>` : ""}
  `;
  els.logBox.textContent = (job.logs || []).join("\n") || "Waiting for logs...";
}

function renderJobRow(job) {
  return `
    <div class="run-row">
      <span class="badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
      <div>
        <strong>${escapeHtml(job.title)}</strong>
        <div class="muted">${escapeHtml(job.id)} · ${escapeHtml(job.updatedAt)}</div>
      </div>
      <div>${job.reportUrl ? `<a href="${job.reportUrl}" target="_blank" rel="noreferrer">Report</a>` : ""}</div>
    </div>
  `;
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function showError(message) {
  els.activeJob.innerHTML = `<span class="badge failed">failed</span><p>${escapeHtml(message)}</p>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}
