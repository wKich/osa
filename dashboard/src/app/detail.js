// Detail view: one sandbox's summary, lifecycle actions, providers, and
// policy revisions.

import { mutate, request } from "./api.js";
import { clearBanner, showError, showNotice } from "./banner.js";
import { clear, formatTimestamp, h, shortHash } from "./dom.js";
import { cleanupLogStream } from "./logs.js";
import { actions, state } from "./state.js";

function sandboxSummary(detail) {
  const sandbox = detail.sandbox;
  const rows = [
    ["Phase", sandbox.phase],
    ["Workspace", sandbox.workspace || "—"],
    ["Policy source", sandbox.policySource],
    ["Revision", sandbox.revision === null || sandbox.revision === undefined ? "—" : String(sandbox.revision)],
    ["Current policy version", String(sandbox.currentPolicyVersion)],
    ["Restart policy", sandbox.restartPolicy],
    ["Exit code", sandbox.exitCode === null || sandbox.exitCode === undefined ? "—" : String(sandbox.exitCode)],
    ["Created", sandbox.createdAt || "—"],
  ];
  const table = h("table");
  for (const [label, value] of rows) {
    table.append(h("tr", null, [
      h("th", { text: label }),
      h("td", { text: value }),
    ]));
  }
  if (sandbox.note) {
    table.append(h("tr", null, [
      h("th", { text: "Note" }),
      h("td", { class: "warn", text: sandbox.note }),
    ]));
  }
  for (const condition of sandbox.conditions || []) {
    table.append(h("tr", null, [
      h("th", { text: condition.type }),
      h("td", { text: `${condition.status} ${condition.reason || ""} ${condition.message || ""}`.trim() }),
    ]));
  }
  return table;
}

function actionButtons() {
  const bar = h("div", { class: "actions" });
  for (const action of ["start", "stop"]) {
    bar.append(h("button", {
      text: action === "start" ? "Start" : "Stop",
      disabled: state.readOnly,
      onclick: async () => {
        try {
          const result = await mutate(`/api/sandboxes/${encodeURIComponent(state.selected)}/${action}`, undefined);
          showNotice(result.message || `${action} accepted`);
          await refreshDetail();
          await actions.loadInventory();
        } catch (_) {
          await actions.loadInventory();
        }
      },
    }));
  }

  const confirmRow = h("div", { class: "actions" });
  const input = h("input", {
    type: "text",
    placeholder: `type ${state.selected} to confirm`,
    disabled: state.readOnly,
    oninput: () => {
      confirm.disabled = state.readOnly || input.value !== state.selected;
    },
  });
  const confirm = h("button", {
    class: "danger",
    text: "Delete",
    disabled: true,
    onclick: async () => {
      if (input.value !== state.selected) return;
      try {
        const result = await mutate(`/api/sandboxes/${encodeURIComponent(state.selected)}/delete`, undefined);
        showNotice(result.message || "deletion accepted");
        await actions.loadInventory();
        actions.navigate("inventory");
      } catch (_) {
        await actions.loadInventory();
      }
    },
  });
  const deleteToggle = h("button", {
    class: "danger",
    text: "Delete…",
    disabled: state.readOnly,
    onclick: () => {
      clearBanner();
      confirmRow.hidden = !confirmRow.hidden;
    },
  });
  confirmRow.hidden = true;
  confirmRow.append(h("span", { class: "muted", text: "Typed confirmation:" }), input, confirm);

  bar.append(deleteToggle);
  const wrapper = h("div");
  wrapper.append(bar, confirmRow);
  if (state.readOnly) {
    wrapper.append(h("p", { class: "muted", text: "Read-only mode: actions are disabled." }));
  }
  return wrapper;
}

function providersTable(providers) {
  if (!providers.length) return h("p", { class: "muted", text: "No providers attached." });
  const table = h("table");
  table.append(h("thead", null, h("tr", null, [
    h("th", { text: "Provider" }),
    h("th", { text: "Type" }),
    h("th", { text: "Credential keys" }),
    h("th", { text: "Config keys" }),
  ])));
  const body = h("tbody");
  for (const provider of providers) {
    body.append(h("tr", null, [
      h("td", { text: provider.name }),
      h("td", { text: provider.type }),
      h("td", { text: (provider.credentialKeys || []).join(", ") || "—" }),
      h("td", { text: (provider.configKeys || []).join(", ") || "—" }),
    ]));
  }
  table.append(body);
  return table;
}

function revisionsTable(revisions) {
  if (!revisions.length) return h("p", { class: "muted", text: "No policy revisions." });
  const table = h("table");
  table.append(h("thead", null, h("tr", null, [
    h("th", { text: "Version" }),
    h("th", { text: "Status" }),
    h("th", { text: "Hash" }),
    h("th", { text: "Created" }),
    h("th", { text: "Loaded" }),
    h("th", { text: "Error" }),
  ])));
  const body = h("tbody");
  for (const revision of revisions) {
    body.append(h("tr", null, [
      h("td", { text: String(revision.version) }),
      h("td", { text: revision.status }),
      h("td", { text: shortHash(revision.hash) }),
      h("td", { text: formatTimestamp(revision.createdAtMs) }),
      h("td", { text: formatTimestamp(revision.loadedAtMs) }),
      h("td", { class: revision.loadError ? "warn" : "muted", text: revision.loadError || "—" }),
    ]));
  }
  table.append(body);
  return table;
}

export async function refreshDetail() {
  if (!state.selected) return;
  try {
    state.detail = await request(`/api/sandboxes/${encodeURIComponent(state.selected)}`);
    if (state.view === "detail") actions.render();
  } catch (error) {
    showError(error);
  }
}

export function renderDetail() {
  clear(state.app);
  if (!state.detail) {
    state.app.append(h("p", { class: "muted", text: "Loading…" }));
    return;
  }
  const detail = state.detail;
  state.app.append(
    h("div", { class: "card" }, [
      h("div", { class: "row" }, [
        h("h2", { text: detail.sandbox.name }),
        h("button", { text: "← Inventory", onclick: () => actions.navigate("inventory") }),
        subViewButtons(),
        actionButtons(),
      ]),
      sandboxSummary(detail),
    ]),
    h("div", { class: "row" }, [
      h("button", { text: "Logs", onclick: () => actions.navigate("logs") }),
      h("button", { text: "Policy", onclick: () => actions.navigate("policy") }),
      h("button", { text: "Rules", onclick: () => actions.navigate("rules") }),
    ]),
    h("div", { class: "card" }, [h("h3", { text: "Providers" }), providersTable(detail.providers || [])]),
    h("div", { class: "card" }, [h("h3", { text: "Policy revisions" }), revisionsTable(detail.revisions || [])]),
  );
  if (detail.errors && Object.keys(detail.errors).length) {
    showError(new Error(`partial data: ${Object.values(detail.errors).join("; ")}`));
  }
}

function subViewButtons() {
  return h("span", { class: "muted", text: state.selected ? `selected: ${state.selected}` : "" });
}

export async function openDetail(name) {
  state.selected = name;
  state.detail = null;
  state.rules = [];
  cleanupLogStream();
  clearBanner();
  actions.navigate("detail");
  await refreshDetail();
}
