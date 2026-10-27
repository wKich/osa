// Setup tab, Images section: each agent's base image from `osa images`, a
// Build action per agent, and the live build log (dashboard-image-build
// design D6). One build runs at a time; it keeps running when the page
// closes, and a page that opens later replays it from the first line. Build
// output reaches the page only as text nodes.

import { mutate, request } from "./api.js";
import { showError, showNotice } from "./banner.js";
import { clear, h } from "./dom.js";
import { state } from "./state.js";

const AGENT_LABELS = { mk: "Maki", oc: "OpenCode", cc: "Claude Code", cx: "Codex" };

export async function loadImages() {
  state.images.loading = true;
  updateImages();
  try {
    const data = await request("/api/images");
    state.images.value = data.images || [];
    state.images.error = null;
  } catch (error) {
    state.images.error = error.message;
  }
  state.images.loading = false;
  updateImages();
}

/** Reads the current or last build and follows it when there is one. */
export async function loadBuild() {
  try {
    const data = await request("/api/images/build");
    state.build.summary = data.build || null;
  } catch (error) {
    showError(error);
    return;
  }
  if (state.build.summary) openBuildStream();
  updateImages();
}

function buildRunning() {
  const summary = state.build.summary;
  return Boolean(summary) && summary.finishedAt === null;
}

export function closeBuildStream() {
  if (state.build.es) {
    state.build.es.close();
    state.build.es = null;
  }
  stopTicker();
}

function openBuildStream() {
  closeBuildStream();
  const source = new EventSource(`/events/build?token=${encodeURIComponent(state.token ?? "")}`);
  state.build.es = source;
  source.addEventListener("start", (event) => {
    // Every (re)connect replays from the start; restart the local view.
    state.build.summary = JSON.parse(event.data);
    state.build.lines = [];
    rebuildLog();
    updateImages();
    startTicker();
  });
  source.addEventListener("line", (event) => {
    state.build.lines.push(event.data);
    appendLogLine(event.data);
  });
  source.addEventListener("done", (event) => {
    state.build.summary = JSON.parse(event.data);
    closeBuildStream();
    updateImages();
    loadImages();
  });
  source.addEventListener("none", () => closeBuildStream());
}

let ticker = null;

function startTicker() {
  stopTicker();
  if (!buildRunning()) return;
  ticker = window.setInterval(() => {
    const status = document.getElementById("build-status");
    if (status) status.textContent = statusText();
    if (!buildRunning()) stopTicker();
  }, 1000);
}

function stopTicker() {
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
}

function elapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The build's status line: running for mm:ss, succeeded, failed (exit N), or cancelled. */
function statusText() {
  const summary = state.build.summary;
  if (!summary) return "";
  const label = `${AGENT_LABELS[summary.agent] || summary.agent} build`;
  if (summary.finishedAt === null) return `${label}: running for ${elapsed(Date.now() - summary.startedAt)}`;
  if (summary.cancelled) return `${label}: cancelled${summary.reason === "timeout" ? " (time limit reached)" : ""}`;
  if (summary.exitCode === 0) return `${label}: succeeded`;
  return `${label}: failed (exit ${summary.exitCode})`;
}

function logView() {
  return document.getElementById("build-log");
}

function appendLogLine(text) {
  const view = logView();
  if (!view) return;
  const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 8;
  view.append(document.createTextNode(`${text}\n`));
  if (atBottom) view.scrollTop = view.scrollHeight;
}

function rebuildLog() {
  const view = logView();
  if (!view) return;
  clear(view);
  for (const line of state.build.lines) view.append(document.createTextNode(`${line}\n`));
  view.scrollTop = view.scrollHeight;
}

async function startBuild(agent) {
  try {
    const data = await mutate(`/api/images/${encodeURIComponent(agent)}/build`, undefined);
    state.build.summary = data.build;
    state.build.lines = [];
    showNotice(`building the ${AGENT_LABELS[agent] || agent} base image`);
    updateImages();
    openBuildStream();
  } catch (_) {
    // mutate shows the error; a 409 means another build started meanwhile.
    loadBuild();
  }
}

async function cancelBuild() {
  try {
    await mutate("/api/images/build/cancel", undefined);
  } catch (_) {
    loadBuild();
  }
}

function imageRow(image) {
  let presence;
  if (image.error) presence = h("span", { class: "warn", text: image.error.message || "error" });
  else if (image.present) presence = h("span", { text: `present${image.created ? ` (created ${image.created})` : ""}` });
  else presence = h("span", { class: "warn", text: "missing" });
  const running = buildRunning();
  return h("tr", { "data-agent": image.agent }, [
    h("td", { text: AGENT_LABELS[image.agent] || image.agent }),
    h("td", { text: image.image || "—" }),
    h("td", null, presence),
    h("td", { text: image.engine || "—" }),
    h("td", { class: image.configured ? "" : "muted", text: image.configured ? `sessions use ${image.configured}` : "—" }),
    h("td", null, state.readOnly
      ? null
      : h("button", {
          text: "Build",
          disabled: running,
          title: running ? "a build is running" : `build ${image.image}`,
          onclick: () => startBuild(image.agent),
        })),
  ]);
}

function imagesTable() {
  if (state.images.error) return h("p", { class: "warn", text: `osa images failed: ${state.images.error}` });
  if (!state.images.value) return h("p", { class: "muted", text: state.images.loading ? "Loading…" : "" });
  const table = h("table", { id: "images-table" });
  table.append(h("thead", null, h("tr", null, [
    h("th", { text: "Agent" }),
    h("th", { text: "Base tag" }),
    h("th", { text: "State" }),
    h("th", { text: "Engine" }),
    h("th", { text: "Configured image" }),
    h("th", { text: "" }),
  ])));
  const body = h("tbody");
  for (const image of state.images.value) body.append(imageRow(image));
  table.append(body);
  return table;
}

function buildPanel() {
  const summary = state.build.summary;
  if (!summary) return null;
  const running = buildRunning();
  const panel = h("div", { class: "build-panel" }, [
    h("div", { class: "row" }, [
      h("span", { id: "build-status", class: "build-status", text: statusText() }),
      running && !state.readOnly
        ? h("button", { text: "Cancel build", onclick: cancelBuild })
        : null,
    ]),
    running ? h("p", { class: "muted", text: "Rebuilding a tag does not change running sandboxes; new sessions use the new image." }) : null,
    summary.dropped > 0 ? h("p", { class: "muted", text: `earlier output dropped (${summary.dropped} lines)` }) : null,
    h("pre", { id: "build-log" }),
  ]);
  return panel;
}

/** The Images section of the Setup tab. */
export function imagesSection() {
  const section = h("div", { class: "card", id: "images-section" });
  fillSection(section);
  return section;
}

function fillSection(section) {
  clear(section);
  section.append(
    h("div", { class: "row" }, [
      h("h3", { text: "Images" }),
      h("button", { text: "Refresh images", onclick: () => loadImages() }),
    ]),
    imagesTable(),
    buildPanel(),
  );
  rebuildLog();
}

/** Re-renders the Images section in place, keeping the rest of the tab. */
export function updateImages() {
  const section = document.getElementById("images-section");
  if (section) fillSection(section);
}
