// Policy view: the effective or base policy, read-only.

import { request } from "./api.js";
import { showError } from "./banner.js";
import { clear, h, shortHash } from "./dom.js";
import { actions, state } from "./state.js";

export async function loadPolicy() {
  try {
    const data = await request(`/api/sandboxes/${encodeURIComponent(state.selected)}/policy?view=${state.policyTab}`);
    state.policy = data.policy;
    if (state.view === "policy") actions.render();
  } catch (error) {
    showError(error);
  }
}

export function renderPolicy() {
  clear(state.app);
  const tabButton = (label, value) =>
    h("button", {
      class: state.policyTab === value ? "active" : "",
      text: label,
      onclick: () => {
        state.policyTab = value;
        loadPolicy();
      },
    });
  const card = h("div", { class: "card" }, [
    h("div", { class: "row" }, [
      h("h2", { text: `Policy: ${state.selected}` }),
      h("button", { text: "← Inventory", onclick: () => actions.navigate("inventory") }),
      h("button", { text: "Detail", onclick: () => actions.navigate("detail") }),
    ]),
    h("div", { class: "actions" }, [tabButton("Effective", "full"), tabButton("Base", "base")]),
    h("p", { class: "muted", text: "Read-only. Edit policy files and apply them with the CLI." }),
  ]);
  if (!state.policy) {
    card.append(h("p", { class: "muted", text: "Loading…" }));
  } else {
    const policy = state.policy;
    card.append(
      h("p", { class: "muted", text: `version ${policy.version} · active ${policy.activeVersion} · ${policy.policySource} · ${shortHash(policy.hash)}` }),
      h("pre", { text: JSON.stringify(policy.policy, null, 2) }),
    );
  }
  state.app.append(card);
}
