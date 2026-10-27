// OpenShell dashboard frontend entry point: vanilla JS ES modules, no
// framework, no build step. This module owns the router and polling and wires
// the cross-view actions; every view imports state.js, never this module.

import { request } from "./api.js";
import { clearBanner, renderStatus, showError } from "./banner.js";
import { clear, h } from "./dom.js";
import { openDetail, renderDetail } from "./detail.js";
import { loadInventory, renderInventory } from "./inventory.js";
import { cleanupLogStream, renderLogs, startLogStream } from "./logs.js";
import { loadPatch, renderPatch } from "./patch.js";
import { failingDoctorSandbox, showHealth, startIdleTicker } from "./health.js";
import { closeBuildStream, imagesSection, loadBuild, loadImages } from "./images.js";
import { loadPolicy, renderPolicy } from "./policy.js";
import { loadProjects, refreshProject, renderProjects, updateProjectsTable } from "./projects.js";
import { loadProviders, providersSection, updateProviders } from "./providers.js";
import { loadDenials, loadRules, renderRules } from "./rules.js";
import { clearCredentialFields } from "./setup.js";
import { actions, state } from "./state.js";

function renderTabs() {
  const onProjects = state.view === "projects" || state.view === "patch";
  const onSetup = state.view === "setup";
  state.tabs.projects.className = onProjects ? "active" : "";
  state.tabs.setup.className = onSetup ? "active" : "";
  state.tabs.sandboxes.className = onProjects || onSetup ? "" : "active";
}

// The Setup tab: provider setup (providers.js, setup.js) and base images
// (images.js).
function renderSetup() {
  clearCredentialFields();
  clear(state.app);
  state.app.append(h("h2", { text: "Setup" }), providersSection(), imagesSection());
}

function render() {
  renderTabs();
  if (state.view === "setup") renderSetup();
  else if (state.view === "projects") renderProjects();
  else if (state.view === "patch") renderPatch();
  else if (state.view === "inventory") renderInventory();
  else if (state.view === "detail") renderDetail();
  else if (state.view === "logs") renderLogs();
  else if (state.view === "policy") renderPolicy();
  else if (state.view === "rules") renderRules();
}

function navigate(view) {
  if (state.view === "logs" && view !== "logs") cleanupLogStream();
  if (state.view === "setup" && view !== "setup") closeBuildStream();
  state.view = view;
  clearBanner();
  render();
  if (view === "logs") startLogStream();
  if (view === "policy") {
    state.policy = null;
    loadPolicy();
  }
  if (view === "rules") {
    loadRules();
    loadDenials(false);
  }
  if (view === "patch") loadPatch();
  if (view === "setup") {
    loadProviders();
    loadImages();
    loadBuild();
  }
  if (view !== "patch") state.patch = null;
}
async function refreshDoctor() {
  try {
    const doctor = await request("/api/doctor");
    state.doctor = doctor;
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
actions.renderStatus = () => {
  if (state.doctor) renderStatus(state.doctor);
};
actions.failingHealth = failingDoctorSandbox;
actions.loadProviders = loadProviders;
actions.updateProviders = updateProviders;
actions.showHealth = (sandbox) => {
  if (state.view !== "projects") navigate("projects");
  showHealth(sandbox);
};

state.tabs.projects.addEventListener("click", () => navigate("projects"));
state.tabs.sandboxes.addEventListener("click", () => navigate("inventory"));
state.tabs.setup.addEventListener("click", () => navigate("setup"));
state.attention.addEventListener("click", () => navigate("projects"));

window.addEventListener("beforeunload", () => {
  cleanupLogStream();
  closeBuildStream();
});

clearBanner();
render();
pollLists();
refreshDoctor();
startPolling();
startIdleTicker();
