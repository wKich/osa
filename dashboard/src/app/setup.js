// Provider wizard: a form inside an agent's Providers card that runs one
// `osa provider setup` through POST /api/providers/setup
// (dashboard-provider-wizard design D5).
//
// The credential is read from the password field's value at submit time and
// passed straight into the request body; it is never kept in `state` or any
// browser storage. The field is cleared after every request, on Cancel, when
// the form is replaced, and on `pagehide`. `state.wizard` holds only the
// non-secret choices and the last outcome, so a re-render keeps them.

import { h } from "./dom.js";
import { actions, state } from "./state.js";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Empties every credential field on the page. */
export function clearCredentialFields() {
  for (const input of document.querySelectorAll("input[data-credential]")) input.value = "";
}

window.addEventListener("pagehide", clearCredentialFields);

/** Registered sandboxes of AGENT that the gateway lists, for the attach choice. */
function attachCandidates(agent) {
  const onGateway = new Set(state.sandboxes.map((sandbox) => sandbox.name));
  return state.projects
    .filter((project) => project.supported && project.agent === agent && onGateway.has(project.sandbox_name))
    .map((project) => project.sandbox_name);
}

function outcomeFrom(status, body) {
  const data = body || {};
  const error = data.error || {};
  if (status === 200) {
    const verb = data.outcome === "updated" ? "Updated the credential of" : "Created";
    const attached = data.attached ? ` and attached it to ${data.attached}` : "";
    return { kind: "notice", text: `${verb} provider ${data.provider}${attached}.`, detail: data.message || "" };
  }
  if (status === 409 && error.kind === "busy") {
    return { kind: "warn", text: "Another provider setup is running; try again when it ends.", detail: "" };
  }
  if (status === 409) return { kind: "warn", text: "Nothing changed.", detail: data.message || error.message || "" };
  if (status === 502 && Array.isArray(data.steps)) {
    const steps = data.steps.length ? `Completed steps: ${data.steps.join(", ")}.` : "No step completed.";
    return { kind: "error", text: `Setup failed. ${steps}`, detail: data.message || error.message || "" };
  }
  return { kind: "error", text: "Setup did not run.", detail: error.message || `HTTP ${status}` };
}

function outcomeView(outcome) {
  if (!outcome) return null;
  return h("div", { class: `setup-outcome ${outcome.kind === "notice" ? "" : outcome.kind}`, "data-outcome": outcome.kind }, [
    h("div", { text: outcome.text }),
    outcome.detail ? h("div", { class: "muted", text: outcome.detail }) : null,
  ]);
}

/** The wizard for one `osa providers` entry whose setup is `stdin`. */
export function wizardForm(entry) {
  const wizard = state.wizard;
  const gateway = Array.isArray(entry.gateway) ? entry.gateway : [];
  const profiles = entry.profiles || [];
  if (!wizard.profile || !profiles.some((profile) => profile.id === wizard.profile)) {
    wizard.profile = profiles.length ? profiles[0].id : "";
  }
  if (!wizard.nameEdited) wizard.name = wizard.profile;

  const profileSelect = h("select", { name: "profile" });
  for (const profile of profiles) {
    const parts = [profile.id, profile.env || "unreadable", profile.source];
    if (profile.note) parts.push(profile.note);
    profileSelect.append(h("option", { value: profile.id, text: parts.join(" · "), selected: profile.id === wizard.profile }));
  }
  const nameInput = h("input", { type: "text", name: "provider-name", value: wizard.name || "", spellcheck: "false", autocomplete: "off" });
  const credentialInput = h("input", {
    type: "password",
    name: "credential",
    "data-credential": "1",
    autocomplete: "new-password",
    spellcheck: "false",
    autocapitalize: "off",
  });
  const attachSelect = h("select", { name: "attach" }, h("option", { value: "", text: "Do not attach" }));
  const candidates = attachCandidates(entry.agent);
  for (const sandbox of candidates) {
    attachSelect.append(h("option", { value: sandbox, text: sandbox, selected: sandbox === wizard.sandbox }));
  }
  const replaceBox = h("input", { type: "checkbox", name: "replace", checked: Boolean(wizard.replace) });
  const replaceRow = h("label", { class: "row" }, [replaceBox, "Replace existing credential"]);
  const submit = h("button", { type: "submit", text: wizard.running ? "Setting up…" : "Set up provider" });
  const hint = h("span", { class: "muted" });

  const taken = () => gateway.includes(nameInput.value.trim());
  const refresh = () => {
    const name = nameInput.value.trim();
    replaceRow.hidden = !taken();
    let reason = "";
    if (!profileSelect.value) reason = "pick a profile";
    else if (!NAME.test(name)) reason = "use a kebab-case provider name";
    else if (!credentialInput.value) reason = "paste the credential";
    else if (taken() && !replaceBox.checked) reason = `provider ${name} exists; choose to replace its credential`;
    submit.disabled = Boolean(wizard.running) || reason !== "";
    hint.textContent = wizard.running ? "" : reason;
  };

  profileSelect.addEventListener("change", () => {
    wizard.profile = profileSelect.value;
    if (!wizard.nameEdited) {
      wizard.name = wizard.profile;
      nameInput.value = wizard.name;
    }
    refresh();
  });
  nameInput.addEventListener("input", () => {
    wizard.name = nameInput.value.trim();
    wizard.nameEdited = true;
    refresh();
  });
  credentialInput.addEventListener("input", refresh);
  attachSelect.addEventListener("change", () => {
    wizard.sandbox = attachSelect.value || null;
  });
  replaceBox.addEventListener("change", () => {
    wizard.replace = replaceBox.checked;
    refresh();
  });

  const form = h("form", { class: "wizard", "data-wizard": entry.agent }, [
    h("div", { class: "form-grid" }, [
      h("label", { class: "field" }, [h("span", { text: "Profile" }), profileSelect]),
      h("label", { class: "field" }, [h("span", { text: "Provider name" }), nameInput]),
      h("label", { class: "field" }, [h("span", { text: "Credential" }), credentialInput]),
      h("label", { class: "field" }, [
        h("span", { text: "Attach to sandbox" }),
        attachSelect,
        candidates.length ? null : h("span", { class: "muted", text: "no registered sandbox of this agent is on the gateway" }),
      ]),
    ]),
    replaceRow,
    h("div", { class: "actions" }, [
      submit,
      h("button", {
        type: "button",
        text: "Cancel",
        onclick: () => {
          credentialInput.value = "";
          state.wizard = null;
          actions.updateProviders();
        },
      }),
      hint,
    ]),
    outcomeView(wizard.outcome),
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    refresh();
    if (submit.disabled) return;
    const name = nameInput.value.trim();
    wizard.running = true;
    wizard.outcome = null;
    submit.textContent = "Setting up…";
    refresh();
    let status = 0;
    let body = null;
    try {
      const response = await fetch("/api/providers/setup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-dashboard-token": state.token || "" },
        body: JSON.stringify({
          agent: entry.agent,
          profile: profileSelect.value,
          name: name === profileSelect.value ? undefined : name,
          attach: attachSelect.value || undefined,
          replace: taken() && replaceBox.checked,
          credential: credentialInput.value,
        }),
      });
      status = response.status;
      try {
        body = await response.json();
      } catch (_) {
        body = null;
      }
    } catch (error) {
      body = { error: { message: error instanceof Error ? error.message : String(error) } };
    } finally {
      credentialInput.value = "";
      wizard.running = false;
    }
    wizard.outcome = outcomeFrom(status, body);
    wizard.replace = false;
    // The list and the inventory refresh without waiting for the next poll.
    await Promise.all([actions.loadProviders(), actions.loadInventory()]);
  });

  refresh();
  return form;
}
