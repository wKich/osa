// Inventory view: the sandbox table and the create form.

import { mutate, request } from "./api.js";
import { showError, showNotice } from "./banner.js";
import { clear, h } from "./dom.js";
import { actions, state } from "./state.js";

export async function loadInventory() {
  try {
    const data = await request("/api/sandboxes");
    state.sandboxes = data.sandboxes || [];
    state.inventoryKnown = true;
    if (state.view === "inventory") updateInventoryTable();
  } catch (error) {
    state.inventoryKnown = false;
    showError(error);
  }
}

function inventoryTable() {
  if (state.sandboxes.length === 0) {
    return h("p", { class: "muted", text: "No sandboxes found." });
  }
  const table = h("table");
  table.append(
    h("thead", null, h("tr", null, [
      h("th", { text: "Name" }),
      h("th", { text: "Phase" }),
      h("th", { text: "Image" }),
      h("th", { text: "Labels" }),
      h("th", { text: "Notes" }),
    ])),
  );
  const body = h("tbody");
  for (const sandbox of state.sandboxes) {
    const labels = Object.keys(sandbox.labels || {})
      .sort()
      .map((key) => `${key}=${sandbox.labels[key]}`)
      .join(", ");
    const image = state.defaults.image || "—";
    body.append(
      h("tr", null, [
        h("td", null, h("button", {
          class: "link",
          text: sandbox.name,
          onclick: () => actions.openDetail(sandbox.name),
        })),
        h("td", { text: sandbox.phase }),
        h("td", null, [
          h("span", { text: image }),
          h("span", { class: "muted", text: " (configured)" }),
        ]),
        h("td", { text: labels || "—" }),
        h("td", { class: sandbox.note ? "warn" : "muted", text: sandbox.note || "—" }),
      ]),
    );
  }
  table.append(body);
  return table;
}

export function updateInventoryTable() {
  const container = document.getElementById("inventory-table");
  if (!container) return;
  clear(container);
  container.append(inventoryTable());
}

function createForm() {
  const fields = {};
  function field(label, key, options) {
    const input = h("input", {
      type: "text",
      value: (options && options.value) || "",
      placeholder: (options && options.placeholder) || "",
      disabled: state.readOnly,
    });
    fields[key] = input;
    return h("label", { class: "field" }, [h("span", { text: label }), input]);
  }

  const defaults = state.defaults || {};
  const form = h("form", {
    class: "card",
    onsubmit: async (event) => {
      event.preventDefault();
      const value = (key) => (fields[key].value || "").trim();
      const providers = value("providers")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const payload = { name: value("name") };
      if (value("image")) payload.image = value("image");
      if (value("policy")) payload.policy = value("policy");
      if (providers.length) payload.providers = providers;
      if (value("cpu")) payload.cpu = value("cpu");
      if (value("memory")) payload.memory = value("memory");
      try {
        const result = await mutate("/api/sandboxes", payload);
        showNotice(result.message || `created ${payload.name}`);
        fields.name.value = "";
        await loadInventory();
      } catch (_) {
        // Error already surfaced.
      }
    },
  });
  form.append(h("h2", { text: "Create sandbox" }));
  if (state.readOnly) {
    form.append(h("p", { class: "muted", text: "Read-only mode: creation is disabled." }));
  }
  form.append(
    h("div", { class: "form-grid" }, [
      field("Name", "name", { placeholder: "maki-myproject" }),
      field("Image", "image", { value: defaults.image || "" }),
      field("Policy", "policy", { value: defaults.policy || "" }),
      field("Providers (comma-separated)", "providers", {
        value: (defaults.providers || []).join(","),
      }),
      field("CPU", "cpu", { value: defaults.cpu || "" }),
      field("Memory", "memory", { value: defaults.memory || "" }),
    ]),
  );
  form.append(
    h("p", null, h("button", {
      type: "submit",
      text: "Create",
      disabled: state.readOnly,
    })),
  );
  form.append(
    h("p", { class: "muted", text: "Defaults come from the helper's config.toml when present." }),
  );
  return form;
}

export function renderInventory() {
  clear(state.app);
  state.app.append(createForm());
  const container = h("div", { id: "inventory-table" });
  container.append(inventoryTable());
  state.app.append(container);
}
