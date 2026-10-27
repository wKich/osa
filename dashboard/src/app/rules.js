// Rules view: pending rule proposals with approve and reject-with-reason,
// and the egress denials behind them. Denials are read only when the view
// opens or the user asks; the denial section has no control that changes
// policy.

import { mutate, request } from "./api.js";
import { showError, showNotice } from "./banner.js";
import { clear, formatAge, formatTimestamp, h } from "./dom.js";
import { actions, state } from "./state.js";

const WINDOWS = [
  ["15m", "last 15 minutes"],
  ["1h", "last hour"],
  ["6h", "last 6 hours"],
];

/** Read the denials for the selected sandbox; `refresh` bypasses the 30 s cache. */
export async function loadDenials(refresh) {
  const sandbox = state.selected;
  const window = state.denialWindow;
  const key = `${sandbox}\n${window}`;
  const previous = state.denials && state.denials.key === key ? state.denials.value : null;
  state.denials = { key, loading: true, value: previous, error: null };
  if (state.view === "rules") actions.render();
  try {
    const query = `window=${encodeURIComponent(window)}${refresh ? "&refresh=1" : ""}`;
    const data = await request(`/api/sandboxes/${encodeURIComponent(sandbox)}/denials?${query}`);
    if (!state.denials || state.denials.key !== key) return;
    state.denials = { key, loading: false, value: data.denials, error: null };
  } catch (error) {
    if (!state.denials || state.denials.key !== key) return;
    // The proposals stay listed; the error shows in the denial section.
    state.denials = { key, loading: false, value: null, error };
  }
  if (state.view === "rules") actions.render();
}

async function reloadAfterDecision() {
  await loadRules();
  await loadDenials(false);
}

export async function loadRules() {
  try {
    const data = await request(`/api/sandboxes/${encodeURIComponent(state.selected)}/rules?status=pending`);
    state.rules = data.rules || [];
    if (state.view === "rules") actions.render();
  } catch (error) {
    showError(error);
  }
}

function rulesTable() {
  if (!state.rules.length) return h("p", { class: "muted", text: "No pending proposals." });
  const table = h("table");
  table.append(h("thead", null, h("tr", null, [
    h("th", { text: "Chunk" }),
    h("th", { text: "Rule" }),
    h("th", { text: "Rationale" }),
    h("th", { text: "Findings" }),
    h("th", { text: "Endpoints" }),
    h("th", { text: "Actions" }),
  ])));
  const body = h("tbody");
  for (const proposal of state.rules) {
    const reasonInput = h("input", { type: "text", placeholder: "reason (required)", disabled: state.readOnly });
    const rejectButton = h("button", {
      class: "danger",
      text: "Reject",
      disabled: true,
      onclick: async () => {
        if (!reasonInput.value.trim()) return;
        try {
          const result = await mutate(
            `/api/sandboxes/${encodeURIComponent(state.selected)}/rules/${encodeURIComponent(proposal.chunkId)}/reject`,
            { reason: reasonInput.value.trim() },
          );
          showNotice(result.message || "proposal rejected");
          await reloadAfterDecision();
        } catch (_) {
          await reloadAfterDecision();
        }
      },
    });
    reasonInput.addEventListener("input", () => {
      rejectButton.disabled = state.readOnly || !reasonInput.value.trim();
    });

    const findings = [proposal.securityNotes, proposal.prover, proposal.applicationError]
      .filter(Boolean)
      .join("; ");

    body.append(h("tr", null, [
      h("td", null, [h("code", { text: proposal.chunkId })]),
      h("td", null, [
        h("div", { text: proposal.ruleName }),
        proposal.confidence !== null && proposal.confidence !== undefined
          ? h("div", { class: "muted", text: `${Math.round(proposal.confidence * 100)}% confidence` })
          : null,
        proposal.binary ? h("div", { class: "muted", text: proposal.binary }) : null,
      ]),
      h("td", { text: proposal.rationale || "—" }),
      h("td", { class: findings ? "warn" : "muted", text: findings || "—" }),
      h("td", { text: proposal.endpoints || "—" }),
      h("td", null, [
        h("button", {
          text: "Approve",
          disabled: state.readOnly,
          onclick: async () => {
            try {
              const result = await mutate(
                `/api/sandboxes/${encodeURIComponent(state.selected)}/rules/${encodeURIComponent(proposal.chunkId)}/approve`,
                undefined,
              );
              showNotice(result.message || "proposal approved");
              await reloadAfterDecision();
            } catch (_) {
              await reloadAfterDecision();
            }
          },
        }),
        reasonInput,
        rejectButton,
      ]),
    ]));
    const matched = denialGroups().filter((group) => group.matches.includes(proposal.chunkId));
    if (matched.length) {
      body.append(h("tr", { class: "denials-row" }, h("td", { colspan: "6" }, [
        h("div", { class: "muted", text: "Denied traffic this proposal would allow:" }),
        denialTable(matched),
      ])));
    }
  }
  table.append(body);
  return table;
}

function denialGroups() {
  const value = state.denials && state.denials.value;
  return value && Array.isArray(value.groups) ? value.groups : [];
}

function destination(group) {
  const host = group.host.includes(":") ? `[${group.host}]` : group.host;
  return group.port === null || group.port === undefined ? host : `${host}:${group.port}`;
}

function denialTable(groups) {
  const table = h("table", { class: "denials" });
  table.append(h("thead", null, h("tr", null, [
    h("th", { text: "Destination" }),
    h("th", { text: "Binary" }),
    h("th", { text: "Count" }),
    h("th", { text: "First seen" }),
    h("th", { text: "Last seen" }),
    h("th", { text: "Reasons" }),
  ])));
  const body = h("tbody");
  for (const group of groups) {
    body.append(h("tr", null, [
      h("td", null, h("code", { text: destination(group) })),
      h("td", { text: group.binary || "—" }),
      h("td", { text: String(group.count) }),
      h("td", { text: formatTimestamp(group.firstSeen) }),
      h("td", { text: formatTimestamp(group.lastSeen) }),
      h("td", { text: (group.reasons || []).join(", ") || "—" }),
    ]));
  }
  table.append(body);
  return table;
}

function denialControls() {
  const select = h("select", {
    onchange: () => {
      state.denialWindow = select.value;
      loadDenials(false);
    },
  }, WINDOWS.map(([value, label]) =>
    h("option", { value, text: label, selected: value === state.denialWindow })));
  const loading = Boolean(state.denials && state.denials.loading);
  return h("div", { class: "row" }, [
    h("h3", { text: "Egress denials" }),
    select,
    h("button", { text: "Refresh denials", disabled: loading, onclick: () => loadDenials(true) }),
    loading ? h("span", { class: "muted", text: "reading logs…" }) : null,
  ]);
}

function denialSection() {
  const current = state.denials;
  const value = current && current.value;
  const parts = [denialControls()];
  if (current && current.error) {
    parts.push(h("p", { class: "warn", text: `Could not read denials: ${current.error.message}` }));
    if (current.error.detail) parts.push(h("pre", { class: "muted", text: current.error.detail }));
  }
  if (value) {
    parts.push(h("p", { class: "muted", text: `Read ${formatAge(value.readAt)} from the sandbox log.` }));
    if (value.capped) {
      parts.push(h("p", { class: "warn", text: "Showing the last 5000 log lines; older denials in this window are not counted." }));
    }
    if (value.unparsed > 0) {
      parts.push(h("p", { class: "warn", text: `${value.unparsed} denial line${value.unparsed === 1 ? "" : "s"} could not be parsed:` }));
      parts.push(h("pre", { class: "unparsed", text: (value.unparsedSamples || []).join("\n") }));
    }
    const unmatched = (value.groups || []).filter((group) => !group.matches.length);
    parts.push(h("h4", { text: "Denied, no proposal" }));
    parts.push(unmatched.length
      ? denialTable(unmatched)
      : h("p", { class: "muted", text: "Every denial in this window matches a pending proposal." }));
  } else if (!current || current.loading) {
    parts.push(h("p", { class: "muted", text: "Loading…" }));
  }
  return h("div", { class: "card", id: "denials" }, parts);
}

export function renderRules() {
  clear(state.app);
  state.app.append(
    h("div", { class: "card" }, [
      h("div", { class: "row" }, [
        h("h2", { text: `Rule proposals: ${state.selected}` }),
        h("button", { text: "← Inventory", onclick: () => actions.navigate("inventory") }),
        h("button", { text: "Detail", onclick: () => actions.navigate("detail") }),
      ]),
      state.readOnly
        ? h("p", { class: "muted", text: "Read-only mode: approval and rejection are disabled." })
        : h("p", { class: "muted", text: "Rejections require a reason; the gateway sends it to the agent." }),
      rulesTable(),
    ]),
    denialSection(),
  );
}
