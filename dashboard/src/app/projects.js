// Projects view: every osa registry entry across agents, with its sandbox,
// pending and orphan badges, the cached host-change result, and an on-demand
// full status. Read-only: nothing here changes a project or the state root.

import { request } from "./api.js";
import { showError, showNotice } from "./banner.js";
import { clear, h } from "./dom.js";
import { openPatch } from "./patch.js";
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
  if (state.sandboxes.some((sandbox) => sandbox.name === name)) {
    return h("td", null, h("button", { class: "link", text: name, onclick: () => actions.openDetail(name) }));
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

function actionsCell(project) {
  const result = state.projectStatus[project.sandbox_name];
  let output = null;
  if (result && result.loading) output = h("div", { class: "muted", text: "checking…" });
  else if (result && result.error) output = h("div", { class: "warn", text: result.error.message });
  else if (result && result.value) output = h("div", { class: "full-status", text: fullStatusText(result.value) });
  return h("td", null, [
    h("div", { class: "actions" }, [
      project.pending === "retained"
        ? h("button", { text: "View patch", onclick: () => openPatch(project.sandbox_name) })
        : null,
      h("button", {
        text: "Check (contacts gateway)",
        disabled: Boolean(result && result.loading),
        onclick: () => checkStatus(project.sandbox_name),
      }),
    ]),
    output,
  ]);
}

function projectRow(project) {
  if (!project.supported) {
    return h("tr", { class: "unsupported" }, [
      h("td", { colspan: "7" }, [
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
    actionsCell(project),
  ]);
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
      h("th", { text: "Status" }),
    ])),
  );
  const body = h("tbody");
  for (const project of state.projects) body.append(projectRow(project));
  table.append(body);
  return table;
}

export function updateProjectsTable() {
  const container = document.getElementById("projects-table");
  if (!container) return;
  clear(container);
  container.append(projectsTable());
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
      text: "Every project an agent front-end registered. Read-only: run the front-end in the project to act on it.",
    }),
  );
  const container = h("div", { id: "projects-table" });
  container.append(projectsTable());
  state.app.append(container);
}
