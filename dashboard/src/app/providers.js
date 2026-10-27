// Setup tab, Providers section: one card per agent from `osa providers`, with
// the providers on the gateway, the remembered providers, and the profiles
// setup can use (dashboard-provider-wizard design D5). A card offers "Set up"
// (the wizard in setup.js) for an agent whose setup reads a credential, or
// the terminal command for one whose setup is a login. Loaded when the tab
// opens and after each setup, never polled.

import { request } from "./api.js";
import { clear, h } from "./dom.js";
import { wizardForm } from "./setup.js";
import { state } from "./state.js";

const AGENT_LABELS = { mk: "Maki", oc: "OpenCode", cc: "Claude Code", cx: "Codex" };

export async function loadProviders() {
  state.providers.loading = true;
  updateProviders();
  try {
    const data = await request("/api/providers");
    state.providers.value = data.providers || [];
    state.providers.error = null;
  } catch (error) {
    state.providers.error = error.message;
  }
  state.providers.loading = false;
  updateProviders();
}

function names(list) {
  return list.length ? list.join(", ") : "none";
}

function profilesTable(profiles) {
  if (!profiles.length) return h("p", { class: "muted", text: "No profiles." });
  const table = h("table");
  table.append(h("thead", null, h("tr", null, [
    h("th", { text: "Profile" }),
    h("th", { text: "Credential variable" }),
    h("th", { text: "Source" }),
    h("th", { text: "Note" }),
  ])));
  const body = h("tbody");
  for (const profile of profiles) {
    body.append(h("tr", null, [
      h("td", { text: profile.id }),
      h("td", { text: profile.env || "—" }),
      h("td", { text: profile.source }),
      h("td", { class: profile.note ? "" : "muted", text: profile.note || "—" }),
    ]));
  }
  table.append(body);
  return table;
}

function loginCommand(entry) {
  const command = entry.command || "";
  return h("div", { class: "row" }, [
    h("span", { text: "Setup is a login on the host. Run in a terminal:" }),
    h("code", { class: "command", text: command }),
    h("button", {
      text: "Copy",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(command);
        } catch (_) {
          // Clipboard access can be denied; the command stays visible.
        }
      },
    }),
  ]);
}

function setupControls(entry) {
  if (entry.setup === "login") return loginCommand(entry);
  if (state.readOnly) return null;
  if (!state.loopback) {
    return h("p", { class: "muted", text: "Provider setup is available only when the dashboard is bound to loopback." });
  }
  if (state.wizard && state.wizard.agent === entry.agent) return wizardForm(entry);
  return h("div", { class: "actions" }, h("button", {
    text: "Set up",
    "data-setup": entry.agent,
    onclick: () => {
      state.wizard = { agent: entry.agent };
      updateProviders();
    },
  }));
}

function providerCard(entry) {
  const gateway = Array.isArray(entry.gateway)
    ? h("span", { text: names(entry.gateway) })
    : h("span", { class: "warn", text: `error: ${(entry.gateway && entry.gateway.error && entry.gateway.error.message) || "unavailable"}` });
  return h("div", { class: "card", "data-providers": entry.agent }, [
    h("h4", { text: `${AGENT_LABELS[entry.agent] || entry.agent} (${entry.agent})` }),
    entry.error
      ? h("p", { class: "warn", text: `error: ${entry.error.message || "unavailable"}` })
      : h("div", null, [
          h("div", null, [h("span", { class: "muted", text: "On the gateway: " }), gateway]),
          h("div", null, [h("span", { class: "muted", text: "Remembered: " }), h("span", { text: names(entry.remembered || []) })]),
          profilesTable(entry.profiles || []),
          setupControls(entry),
        ]),
  ]);
}

/** The Providers section of the Setup tab. */
export function providersSection() {
  const section = h("div", { class: "card", id: "providers-section" });
  fillSection(section);
  return section;
}

function fillSection(section) {
  clear(section);
  section.append(h("div", { class: "row" }, [
    h("h3", { text: "Providers" }),
    h("button", { text: "Refresh providers", onclick: () => loadProviders() }),
  ]));
  if (state.providers.error) {
    section.append(h("p", { class: "warn", text: `osa providers failed: ${state.providers.error}` }));
    return;
  }
  if (!state.providers.value) {
    section.append(h("p", { class: "muted", text: state.providers.loading ? "Loading…" : "" }));
    return;
  }
  for (const entry of state.providers.value) section.append(providerCard(entry));
}

/** Re-renders the Providers section in place. */
export function updateProviders() {
  const section = document.getElementById("providers-section");
  if (section) fillSection(section);
}
