// Health panel: one registered project's idle stop, MCP readiness, and doctor
// checks from `osa health SANDBOX --json`, loaded only when the user opens the
// panel or presses Refresh. The idle cell on each project row counts down
// from the cached quick status every second without a request. Nothing here
// changes configuration, providers, or the sandbox.

import { request } from "./api.js";
import { h } from "./dom.js";
import { actions, state } from "./state.js";

const IDLE_LABELS = {
  off: "off",
  none: "no session",
  running: "session running",
  stopped: "stopped",
  skipped: "skipped",
  failed: "stop failed",
};

function formatLeft(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${rest}s`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

/** The idle text for a state and deadline at time `now` (milliseconds). */
export function idleText(idle, now) {
  if (!idle || typeof idle.state !== "string") return "—";
  if (idle.state !== "counting") return IDLE_LABELS[idle.state] || idle.state;
  const deadline = idle.deadline ? Date.parse(idle.deadline) : NaN;
  if (!Number.isFinite(deadline)) return "counting down";
  const left = Math.round((deadline - (now ?? Date.now())) / 1000);
  if (left <= 0) return "stop due";
  return `stops in ${formatLeft(left)}${idle.estimated ? " (estimated)" : ""}`;
}

/** A span that the ticker keeps current while the idle state is counting. */
export function idleView(idle) {
  const counting = idle && idle.state === "counting" && idle.deadline;
  return h("span", {
    class: counting ? "idle idle-counting" : "idle muted",
    "data-idle-deadline": counting ? idle.deadline : null,
    "data-idle-estimated": counting && idle.estimated ? "1" : null,
    title: idle && idle.deadline ? `stop deadline ${idle.deadline}` : null,
    text: idleText(idle),
  });
}

/** Updates every counting idle span once a second; never sends a request. */
export function startIdleTicker() {
  window.setInterval(() => {
    const now = Date.now();
    for (const node of document.querySelectorAll("[data-idle-deadline]")) {
      const idle = {
        state: "counting",
        deadline: node.getAttribute("data-idle-deadline"),
        estimated: node.getAttribute("data-idle-estimated") === "1",
      };
      node.textContent = idleText(idle, now);
    }
  }, 1000);
}

/** Opens the panel for a sandbox and runs `osa health` for it. */
export function openHealth(sandbox) {
  state.healthOpen = sandbox;
  return loadHealth(sandbox);
}

/** Shows the panel with the last result, without running anything. */
export function showHealth(sandbox) {
  state.healthOpen = sandbox;
  actions.render();
}

export async function loadHealth(sandbox) {
  const previous = state.health[sandbox];
  state.health[sandbox] = { loading: true, value: previous ? previous.value : null, error: null };
  actions.render();
  try {
    const data = await request(`/api/projects/${encodeURIComponent(sandbox)}/health`);
    state.health[sandbox] = { loading: false, value: data.health, error: null, at: Date.now() };
  } catch (error) {
    state.health[sandbox] = { loading: false, value: previous ? previous.value : null, error };
  }
  actions.render();
  actions.renderStatus();
}

/** The first sandbox whose last opened panel had a failing doctor check, or null. */
export function failingDoctorSandbox() {
  for (const project of state.projects) {
    const result = state.health[project.sandbox_name];
    const doctor = result && result.value && result.value.doctor;
    if (doctor && Array.isArray(doctor.checks) && doctor.checks.some((check) => check.status === "fail")) {
      return project.sandbox_name;
    }
  }
  return null;
}

function sectionError(section) {
  return section && typeof section.error === "string" && section.error ? section.error : null;
}

function idleSection(idle) {
  const rows = [["State", idleText(idle)]];
  if (idle && idle.deadline) rows.push(["Deadline", `${idle.deadline}${idle.estimated ? " (estimated)" : ""}`]);
  if (idle && idle.period !== null && idle.period !== undefined) rows.push(["Period", `${idle.period}s`]);
  if (idle && idle.last_event) rows.push(["Last event", `${idle.last_event}${idle.last_time ? ` at ${idle.last_time}` : ""}`]);
  const table = h("table");
  for (const [label, value] of rows) table.append(h("tr", null, [h("th", { text: label }), h("td", { text: value })]));
  return h("div", { class: "health-section" }, [h("h4", { text: "Idle stop" }), table]);
}

function mcpSection(mcp) {
  const parts = [h("h4", { text: "MCP readiness" })];
  const error = sectionError(mcp);
  if (mcp && mcp.supported === false) {
    parts.push(h("p", { class: "muted", text: "unsupported: this agent's front-end has no mcp status" }));
  } else if (error) {
    parts.push(h("p", { class: "warn", text: `error: ${error}` }));
  }
  const servers = mcp && Array.isArray(mcp.servers) ? mcp.servers : [];
  if (servers.length) {
    const table = h("table");
    table.append(h("thead", null, h("tr", null, [
      h("th", { text: "Server" }),
      h("th", { text: "Transport" }),
      h("th", { text: "Gate" }),
      h("th", { text: "Result" }),
      h("th", { text: "Fix" }),
    ])));
    const body = h("tbody");
    for (const server of servers) {
      for (const gate of server.gates || []) {
        body.append(h("tr", null, [
          h("td", { text: server.name }),
          h("td", { text: server.transport || "—" }),
          h("td", { text: gate.gate }),
          h("td", { class: gate.ok ? "" : "warn", text: gate.ok ? "pass" : "fail" }),
          h("td", { text: gate.fix || "—" }),
        ]));
      }
    }
    table.append(body);
    parts.push(table);
  } else if (mcp && mcp.supported !== false && !error) {
    parts.push(h("p", { class: "muted", text: "none configured" }));
  }
  return h("div", { class: "health-section" }, parts);
}

function doctorSection(doctor) {
  const parts = [h("h4", { text: "Doctor" })];
  const error = sectionError(doctor);
  if (error) parts.push(h("p", { class: "warn", text: `error: ${error}` }));
  const checks = doctor && Array.isArray(doctor.checks) ? doctor.checks : [];
  if (checks.length) {
    const table = h("table");
    table.append(h("thead", null, h("tr", null, [
      h("th", { text: "Status" }),
      h("th", { text: "Check" }),
      h("th", { text: "Detail" }),
    ])));
    const body = h("tbody");
    for (const check of checks) {
      body.append(h("tr", null, [
        h("td", { class: check.status === "fail" || check.status === "warn" ? "warn" : "", text: check.status }),
        h("td", { text: check.name }),
        h("td", { text: check.detail || "—" }),
      ]));
    }
    table.append(body);
    parts.push(table);
  }
  return h("div", { class: "health-section" }, parts);
}

/** The panel for one sandbox; only Refresh and Close are controls. */
export function healthPanel(sandbox, onClose) {
  const result = state.health[sandbox];
  const loading = Boolean(result && result.loading);
  const panel = h("div", { class: "card health-panel", "data-health": sandbox }, [
    h("div", { class: "row" }, [
      h("h3", { text: `Health: ${sandbox}` }),
      h("button", { text: "Refresh health", disabled: loading, onclick: () => loadHealth(sandbox) }),
      h("button", { text: "Close", onclick: onClose }),
      loading ? h("span", { class: "muted", text: "running osa health…" }) : null,
    ]),
  ]);
  if (result && result.error) {
    panel.append(h("p", { class: "warn", text: `osa health failed: ${result.error.message}` }));
    if (result.error.detail) panel.append(h("pre", { class: "muted", text: result.error.detail }));
  }
  const value = result && result.value;
  if (value) {
    panel.append(idleSection(value.idle), mcpSection(value.mcp), doctorSection(value.doctor));
  } else if (!result || loading) {
    panel.append(h("p", { class: "muted", text: "Loading…" }));
  }
  return panel;
}

