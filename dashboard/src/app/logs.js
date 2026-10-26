// Logs view: the SSE log tail with source and level filters.

import { clearBanner, showError, showNotice } from "./banner.js";
import { clear, h } from "./dom.js";
import { actions, state } from "./state.js";

const LOG_LINE_LIMIT = 5000;
const LEVEL_RANK = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

function parseLogLine(text) {
  const match = /^\[[^\]]+\]\s*\[([^\]]+)\]\s*\[([^\]]+)\]/.exec(text);
  if (!match) return { source: null, level: null };
  // The CLI emits uppercase levels/sources; filters are lowercase.
  return { source: match[1].trim().toLowerCase(), level: match[2].trim().toLowerCase() };
}

function logMatches(entry) {
  if (state.logs.source !== "all") {
    if (!entry.source) return true; // unparsed lines are never silently hidden
    if (entry.source !== state.logs.source) return false;
  }
  if (state.logs.level !== "all") {
    if (!entry.level) return true;
    const minimum = LEVEL_RANK[state.logs.level];
    const rank = LEVEL_RANK[entry.level];
    // Unknown levels (for example OCSF) are shown rather than silently hidden.
    if (rank !== undefined && minimum !== undefined && rank < minimum) return false;
  }
  return true;
}

function logContainer() {
  return document.getElementById("log-view");
}

function appendLogLine(entry) {
  const container = logContainer();
  if (!container || !logMatches(entry)) return;
  const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 8;
  container.append(h("div", { class: `log-line log-${entry.level || "raw"}`, text: entry.text }));
  if (atBottom) container.scrollTop = container.scrollHeight;
}

function rebuildLogView() {
  const container = logContainer();
  if (!container) return;
  clear(container);
  for (const entry of state.logs.lines) {
    if (logMatches(entry)) container.append(h("div", { class: `log-line log-${entry.level || "raw"}`, text: entry.text }));
  }
  container.scrollTop = container.scrollHeight;
}

export function cleanupLogStream() {
  if (state.logs.es) {
    state.logs.es.close();
    state.logs.es = null;
  }
}

export function startLogStream() {
  cleanupLogStream();
  state.logs.lines = [];
  state.logs.ended = false;
  state.logs.started = true;
  const source = new EventSource(
    `/events/logs?name=${encodeURIComponent(state.selected)}&token=${encodeURIComponent(state.token ?? "")}`,
  );
  state.logs.es = source;

  source.addEventListener("ready", () => {
    // The server replays its ring buffer on every (re)connect; restart the
    // local view so reconnect does not duplicate lines.
    state.logs.lines = [];
    rebuildLogView();
  });
  source.onmessage = (event) => {
    const entry = { text: event.data, ...parseLogLine(event.data) };
    state.logs.lines.push(entry);
    if (state.logs.lines.length > LOG_LINE_LIMIT) {
      state.logs.lines.shift();
      rebuildLogView();
      return;
    }
    if (!state.logs.paused) appendLogLine(entry);
  };
  source.addEventListener("end", (event) => {
    state.logs.ended = true;
    cleanupLogStream();
    showNotice(`log stream ended (exit ${event.data || "?"}); press Reconnect to tail again`);
  });
  source.addEventListener("failure", (event) => {
    state.logs.ended = true;
    cleanupLogStream();
    showError(new Error(event.data || "log stream failed"));
  });
  source.onerror = () => {
    // Named `end`/`failure` events close the stream deliberately; anything
    // else is a transport hiccup and EventSource retries by itself.
    if (state.logs.ended) cleanupLogStream();
  };
}

function logsControls() {
  const sourceSelect = h("select", {
    onchange: () => {
      state.logs.source = sourceSelect.value;
      rebuildLogView();
    },
  });
  for (const option of ["all", "gateway", "sandbox"]) {
    sourceSelect.append(h("option", { value: option, text: `source: ${option}`, selected: state.logs.source === option }));
  }

  const levelSelect = h("select", {
    onchange: () => {
      state.logs.level = levelSelect.value;
      rebuildLogView();
    },
  });
  for (const option of ["all", "error", "warn", "info", "debug", "trace"]) {
    levelSelect.append(h("option", { value: option, text: `min level: ${option}`, selected: state.logs.level === option }));
  }

  const pauseButton = h("button", {
    text: state.logs.paused ? "Resume" : "Pause",
    onclick: () => {
      state.logs.paused = !state.logs.paused;
      pauseButton.textContent = state.logs.paused ? "Resume" : "Pause";
      if (!state.logs.paused) rebuildLogView();
    },
  });

  return h("div", { class: "actions" }, [
    sourceSelect,
    levelSelect,
    pauseButton,
    h("button", {
      text: "Reconnect",
      onclick: () => {
        clearBanner();
        startLogStream();
      },
    }),
    h("button", {
      text: "Clear",
      onclick: () => {
        state.logs.lines = [];
        rebuildLogView();
      },
    }),
  ]);
}

export function renderLogs() {
  clear(state.app);
  state.app.append(
    h("div", { class: "card" }, [
      h("div", { class: "row" }, [
        h("h2", { text: `Logs: ${state.selected}` }),
        h("button", { text: "← Inventory", onclick: () => actions.navigate("inventory") }),
        h("button", { text: "Detail", onclick: () => actions.navigate("detail") }),
      ]),
      logsControls(),
      h("div", { id: "log-view" }),
    ]),
  );
  rebuildLogView();
}
