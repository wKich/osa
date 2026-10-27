// Projects view: every osa registry entry across agents, with its sandbox,
// pending and orphan badges, the cached host-change result, and an on-demand
// full status. Outside read-only mode a parked row offers Rescue and Discard;
// a retained row's Apply, Branch, and Drop live in the patch viewer. Those
// resolve actions are the only writes; everything else here only reads. The
// idle cell counts down from the cached quick status, and Health opens the
// on-demand health panel (health.js) under the row.

import { request } from "./api.js";
import { showError, showNotice } from "./banner.js";
import { clear, deniedBadge, h } from "./dom.js";
import { healthPanel, idleView, openHealth } from "./health.js";
import { openPatch, updatePatchActions } from "./patch.js";
import {
  disabledReason,
  focusedConfirmKey,
  outcomeView,
  restoreConfirmFocus,
  runResolve,
  typedConfirm,
} from "./resolve.js";
import { actions, state } from "./state.js";

const AGENT_LABELS = { mk: "Maki", oc: "OpenCode", cc: "Claude Code", cx: "Codex" };

const HOST_CHANGE_TEXT = {
  changed: "changed since last sync",
  unchanged: "unchanged since last sync",
  unknown: "unknown",
};

/** Projects with a retained patch, a parked workspace, or a missing folder. */
export function attentionCount(projects) {
  return projects.filter((project) => project.pending !== "" || project.orphan).length;
}

export function updateAttention() {
  const count = attentionCount(state.projects);
  state.attention.hidden = count === 0;
  state.attention.textContent = count === 0 ? "" : `${count} need${count === 1 ? "s" : ""} attention`;
}

export async function loadProjects(refresh) {
  try {
    const data = await request(`/api/projects${refresh ? "?refresh=1" : ""}`);
    state.projects = data.projects || [];
    state.projectsLoaded = true;
  } catch (error) {
    showError(error);
  }
  updateAttention();
  if (state.view === "projects") updateProjectsTable();
  if (state.view === "patch") updatePatchActions();
}

/** Re-reads the rows registered at one host path and checks it again (design D4). */
export async function refreshProject(hostPath) {
  try {
    const data = await request(`/api/projects?refresh=1&path=${encodeURIComponent(hostPath)}`);
    const fresh = new Map((data.projects || []).map((project) => [project.file, project]));
    // Keep the row order: replace in place, drop rows gone from that path, append new ones.
    const merged = state.projects
      .filter((project) => fresh.has(project.file) || !(project.supported && project.host_path === hostPath))
      .map((project) => fresh.get(project.file) || project);
    for (const project of fresh.values()) if (!merged.includes(project)) merged.push(project);
    state.projects = merged;
  } catch (error) {
    showError(error);
  }
  updateAttention();
  if (state.view === "projects") updateProjectsTable();
}

async function checkStatus(sandbox) {
  state.projectStatus[sandbox] = { loading: true, value: null, error: null };
  updateProjectsTable();
  try {
    const data = await request(`/api/projects/${encodeURIComponent(sandbox)}/status`);
    state.projectStatus[sandbox] = { loading: false, value: data.status, error: null };
  } catch (error) {
    state.projectStatus[sandbox] = { loading: false, value: null, error };
  }
  updateProjectsTable();
}

function badge(kind, text) {
  return h("span", { class: `badge badge-${kind}`, text });
}

function sandboxCell(project) {
  const name = project.sandbox_name;
  if (state.inventoryKnown !== true) {
    return h("td", null, [h("div", { text: name }), h("div", { class: "muted", text: "gateway unknown" })]);
  }
  const sandbox = state.sandboxes.find((entry) => entry.name === name);
  if (sandbox) {
    return h("td", null, [
      h("button", { class: "link", text: name, onclick: () => actions.openDetail(name) }),
      deniedBadge(sandbox.denials),
    ]);
  }
  return h("td", null, [h("div", { text: name }), h("div", { class: "muted", text: "not on gateway" })]);
}

function syncCell(project) {
  const badges = [];
  if (project.pending) badges.push(badge(project.pending, project.pending));
  if (project.orphan) badges.push(badge("orphan", "orphan: folder missing"));
  if (!badges.length) badges.push(h("span", { class: "muted", text: "nothing pending" }));
  return h("td", null, [
    h("div", null, badges),
    project.note ? h("div", { class: "warn", text: project.note }) : null,
  ]);
}

function hostCell(project) {
  if (project.osaError) {
    return h("td", { class: "warn", text: `unavailable: ${project.osaError.message}` });
  }
  if (!project.fingerprintResult) return h("td", { class: "muted", text: "checking…" });
  const checked = project.checkedAt
    ? h("div", { class: "muted", text: `checked ${new Date(project.checkedAt).toLocaleTimeString()}` })
    : null;
  return h("td", null, [
    h("div", {
      class: project.fingerprintResult === "changed" ? "warn" : "",
      text: HOST_CHANGE_TEXT[project.fingerprintResult] || project.fingerprintResult,
    }),
    checked,
  ]);
}

function fullStatusText(entry) {
  const status = entry.status;
  if (!status || typeof status !== "object") {
    return entry.orphan ? "folder missing: no status" : "the front-end reported no status";
  }
  if (!status.sync && !status.phase) return "the front-end reported no status";
  const parts = [
    `sync: ${status.sync || "—"}`,
    `phase: ${status.phase || "—"}`,
    `next: ${status.next || "—"}`,
  ];
  return parts.join(" · ");
}

/** Rescue and Discard for a parked workspace (design D3); null when none apply. */
function parkedActions(project) {
  if (state.readOnly || project.orphan || project.pending !== "parked") return null;
  const sandbox = project.sandbox_name;
  const reason = disabledReason(project);
  const confirming = state.resolveConfirm[sandbox] === "discard" && !reason;
  return h("div", { class: "resolve-actions" }, [
    h("div", { class: "actions" }, [
      h("button", {
        text: "Rescue",
        disabled: Boolean(reason),
        title: "Copy the sandbox workspace into a rescue folder; the workspace stays parked",
        onclick: () => runResolve(sandbox, "rescue", updateProjectsTable),
      }),
      h("button", {
        class: "danger",
        text: "Discard",
        disabled: Boolean(reason),
        title: "Replace the sandbox workspace with the host project",
        onclick: () => {
          state.resolveConfirm[sandbox] = confirming ? null : "discard";
          updateProjectsTable();
        },
      }),
      reason ? h("span", { class: "muted", text: reason }) : null,
    ]),
    confirming ? typedConfirm(sandbox, "discard", updateProjectsTable) : null,
  ]);
}

function actionsCell(project) {
  const result = state.projectStatus[project.sandbox_name];
  let output = null;
  if (result && result.loading) output = h("div", { class: "muted", text: "checking…" });
  else if (result && result.error) output = h("div", { class: "warn", text: result.error.message });
  else if (result && result.value) output = h("div", { class: "full-status", text: fullStatusText(result.value) });
  const retained = project.pending === "retained" && !project.orphan;
  const reason = retained && !state.readOnly ? disabledReason(project) : null;
  return h("td", null, [
    h("div", { class: "actions" }, [
      retained
        ? h("button", { text: "Review patch", onclick: () => openPatch(project.sandbox_name) })
        : null,
      h("button", {
        text: "Check (contacts gateway)",
        disabled: Boolean(result && result.loading),
        onclick: () => checkStatus(project.sandbox_name),
      }),
      h("button", {
        text: "Health",
        title: "Run osa health: idle stop, MCP readiness, and doctor checks (contacts gateway)",
        onclick: () => openHealth(project.sandbox_name),
      }),
      reason ? h("span", { class: "muted", text: reason }) : null,
    ]),
    parkedActions(project),
    outcomeView(project.sandbox_name),
    output,
  ]);
}

function projectRow(project) {
  if (!project.supported) {
    return h("tr", { class: "unsupported" }, [
      h("td", { colspan: "8" }, [
        h("code", { text: project.file }),
        h("span", { class: "warn", text: ` ${project.note || ""}` }),
      ]),
    ]);
  }
  const label = AGENT_LABELS[project.agent];
  return h("tr", null, [
    h("td", { title: project.agent, text: label || project.agent }),
    h("td", { text: project.project }),
    h("td", null, h("code", { text: project.host_path })),
    sandboxCell(project),
    syncCell(project),
    hostCell(project),
    h("td", { class: "idle-cell" }, idleView(project.idle)),
    actionsCell(project),
  ]);
}

/** The open Health panel, as a full-width row under its project. */
function healthRow(project) {
  if (!project.supported || state.healthOpen !== project.sandbox_name) return null;
  return h("tr", { class: "health-row" }, h("td", { colspan: "8" }, healthPanel(project.sandbox_name, () => {
    state.healthOpen = null;
    updateProjectsTable();
  })));
}

function projectsTable() {
  if (!state.projectsLoaded) return h("p", { class: "muted", text: "Loading…" });
  if (state.projects.length === 0) {
    return h("div", { class: "card" }, [
      h("p", { text: "No registered projects." }),
      h("p", { class: "muted" }, [
        "Run ",
        h("code", { text: "maki-oss up" }),
        ", ",
        h("code", { text: "opencode-oss up" }),
        ", or ",
        h("code", { text: "claude-oss up" }),
        " in a project folder to register it.",
      ]),
    ]);
  }
  const table = h("table");
  table.append(
    h("thead", null, h("tr", null, [
      h("th", { text: "Agent" }),
      h("th", { text: "Project" }),
      h("th", { text: "Host path" }),
      h("th", { text: "Sandbox" }),
      h("th", { text: "Pending" }),
      h("th", { text: "Host" }),
      h("th", { text: "Idle stop" }),
      h("th", { text: "Status" }),
    ])),
  );
  const body = h("tbody");
  for (const project of state.projects) {
    body.append(projectRow(project));
    const panel = healthRow(project);
    if (panel) body.append(panel);
  }
  table.append(body);
  return table;
}

export function updateProjectsTable() {
  const container = document.getElementById("projects-table");
  if (!container) return;
  // The table is rebuilt on every poll; keep a typed confirmation focused.
  const focused = focusedConfirmKey();
  clear(container);
  container.append(projectsTable());
  restoreConfirmFocus(container, focused);
}

export function renderProjects() {
  clear(state.app);
  state.app.append(
    h("div", { class: "row" }, [
      h("h2", { text: "Projects" }),
      h("button", {
        text: "Check host changes",
        onclick: async () => {
          await loadProjects(true);
          showNotice("Host checks requested; results appear within a few seconds.");
        },
      }),
    ]),
    h("p", {
      class: "muted",
      text: state.readOnly
        ? "Every project an agent front-end registered. Read-only mode: run osa resolve or the front-end in the project to act on it."
        : "Every project an agent front-end registered. Resolve a retained patch from its patch view, or a parked workspace from its row; each action runs osa resolve.",
    }),
  );
  const container = h("div", { id: "projects-table" });
  container.append(projectsTable());
  state.app.append(container);
}
