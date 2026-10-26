// OpenShell dashboard frontend entry point: vanilla JS ES modules, no
// framework, no build step. This module owns the router and polling and wires
// the cross-view actions; every view imports state.js, never this module.

import { request } from "./api.js";
import { clearBanner, renderStatus, showError } from "./banner.js";
import { clear } from "./dom.js";
import { openDetail, renderDetail } from "./detail.js";
import { loadInventory, renderInventory } from "./inventory.js";
import { cleanupLogStream, renderLogs, startLogStream } from "./logs.js";
import { loadPatch, renderPatch } from "./patch.js";
import { loadPolicy, renderPolicy } from "./policy.js";
import { loadProjects, refreshProject, renderProjects, updateProjectsTable } from "./projects.js";
import { loadRules, renderRules } from "./rules.js";
import { actions, state } from "./state.js";

function renderTabs() {
  const onProjects = state.view === "projects" || state.view === "patch";
  state.tabs.projects.className = onProjects ? "active" : "";
  state.tabs.sandboxes.className = onProjects ? "" : "active";
}

function render() {
  renderTabs();
  if (state.view === "projects") renderProjects();
  else if (state.view === "patch") renderPatch();
  else if (state.view === "inventory") renderInventory();
  else if (state.view === "detail") renderDetail();
  else if (state.view === "logs") renderLogs();
  else if (state.view === "policy") renderPolicy();
  else if (state.view === "rules") renderRules();
}

function navigate(view) {
  if (state.view === "logs" && view !== "logs") cleanupLogStream();
  state.view = view;
  clearBanner();
  render();
  if (view === "logs") startLogStream();
  if (view === "policy") {
    state.policy = null;
    loadPolicy();
  }
  if (view === "rules") loadRules();
  if (view === "patch") loadPatch();
  if (view !== "patch") state.patch = null;
}
async function refreshDoctor() {
  try {
    const doctor = await request("/api/doctor");
    renderStatus(doctor);
  } catch (error) {
    clear(state.status);
    state.status.append("dashboard unavailable");
    showError(error);
  }
}

// Projects and inventory are polled from every view: the attention counter is
// always visible, and the Projects view joins against the inventory.
function pollLists() {
  loadProjects(false);
  loadInventory().then(() => {
    if (state.view === "projects") updateProjectsTable();
  });
}

function startPolling() {
  window.setInterval(pollLists, state.refreshMs);
  window.setInterval(() => {
    refreshDoctor();
  }, 30000);
}

actions.navigate = navigate;
actions.render = render;
actions.loadInventory = loadInventory;
actions.openDetail = openDetail;
actions.refreshProject = refreshProject;

state.tabs.projects.addEventListener("click", () => navigate("projects"));
state.tabs.sandboxes.addEventListener("click", () => navigate("inventory"));
state.attention.addEventListener("click", () => navigate("projects"));

window.addEventListener("beforeunload", () => {
  cleanupLogStream();
});

clearBanner();
render();
pollLists();
refreshDoctor();
startPolling();
