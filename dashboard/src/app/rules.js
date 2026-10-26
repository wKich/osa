// Rules view: pending rule proposals with approve and reject-with-reason.

import { mutate, request } from "./api.js";
import { showError, showNotice } from "./banner.js";
import { clear, h } from "./dom.js";
import { actions, state } from "./state.js";

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
          await loadRules();
        } catch (_) {
          await loadRules();
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
              await loadRules();
            } catch (_) {
              await loadRules();
            }
          },
        }),
        reasonInput,
        rejectButton,
      ]),
    ]));
  }
  table.append(body);
  return table;
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
  );
}
