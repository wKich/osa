// Resolve actions: the one project write. Each action posts to
// `/api/projects/:sandbox/resolve`, which runs `osa resolve`; the outcome
// (what changed, a refusal, or an error) is shown as text through `h()`, and
// the project's rows are refreshed at once instead of waiting for the poll.

import { request } from "./api.js";
import { h } from "./dom.js";
import { actions, state } from "./state.js";

export const BUSY_REASON = "a session is running";

const ACTION_LABELS = {
  apply: "Apply",
  branch: "Branch",
  drop: "Drop",
  rescue: "Rescue",
  discard: "Discard",
};

/** The supported registry row for a sandbox, or null. */
export function projectFor(sandbox) {
  return state.projects.find((project) => project.supported && project.sandbox_name === sandbox) || null;
}

export function isResolving(sandbox) {
  const outcome = state.resolveOutcome[sandbox];
  return Boolean(outcome && outcome.running);
}

/** Why a project's actions are disabled, or null. */
export function disabledReason(project) {
  if (project.busy) return BUSY_REASON;
  if (isResolving(project.sandbox_name)) return "an action is running";
  return null;
}

/** Runs one resolve action; `onUpdate` re-renders whatever shows the outcome. */
export async function runResolve(sandbox, action, onUpdate) {
  if (isResolving(sandbox)) return;
  const project = projectFor(sandbox);
  state.resolveConfirm[sandbox] = null;
  state.resolveOutcome[sandbox] = { running: true, action };
  onUpdate();
  let outcome;
  try {
    const data = await request(`/api/projects/${encodeURIComponent(sandbox)}/resolve`, {
      method: "POST",
      body: { action },
      token: true,
    });
    outcome = { kind: "done", action, changed: data.changed || [], message: data.message || "" };
  } catch (error) {
    // 409 covers osa's refusal and a resolve already running: nothing changed.
    const refused = error.kind === "refused" || error.kind === "busy";
    outcome = {
      kind: refused ? "refused" : "error",
      action,
      changed: [],
      message: error.message || "",
      detail: error.detail || "",
    };
  }
  state.resolveOutcome[sandbox] = outcome;
  delete state.resolveTyped[`${sandbox}:${action}`];
  if (project) await actions.refreshProject(project.host_path);
  onUpdate();
}

/** The last outcome for a sandbox, as text nodes, or null. */
export function outcomeView(sandbox) {
  const outcome = state.resolveOutcome[sandbox];
  if (!outcome) return null;
  const label = ACTION_LABELS[outcome.action] || outcome.action;
  if (outcome.running) {
    return h("div", { class: "muted resolve-outcome", text: `${label}: running…` });
  }
  if (outcome.kind === "done") {
    return h("div", { class: "resolve-outcome" }, [
      h("div", { text: `${label} done.${outcome.message ? ` ${outcome.message}` : ""}` }),
      outcome.changed.length
        ? h("ul", null, outcome.changed.map((entry) => h("li", null, h("code", { text: entry }))))
        : h("div", { class: "muted", text: "osa listed no changed paths." }),
    ]);
  }
  if (outcome.kind === "refused") {
    return h("div", { class: "warn resolve-outcome" }, [
      h("div", { text: `${label}: nothing changed.` }),
      outcome.message ? h("div", { text: outcome.message }) : null,
    ]);
  }
  return h("div", { class: "warn resolve-outcome" }, [
    h("div", { text: `${label} failed: ${outcome.message || "unknown error"}` }),
    outcome.detail ? h("pre", { text: outcome.detail }) : null,
  ]);
}

/**
 * A typed confirmation for drop and discard: the confirm button stays
 * disabled, and sends nothing, until the input holds the exact sandbox name.
 * The typed text lives in state so a table rebuild keeps it.
 */
export function typedConfirm(sandbox, action, onUpdate) {
  const key = `${sandbox}:${action}`;
  const label = ACTION_LABELS[action];
  const confirm = h("button", {
    class: "danger",
    text: `Confirm ${action}`,
    disabled: state.resolveTyped[key] !== sandbox,
    onclick: () => {
      if (state.resolveTyped[key] !== sandbox) return;
      runResolve(sandbox, action, onUpdate);
    },
  });
  const input = h("input", {
    type: "text",
    placeholder: `type ${sandbox} to confirm`,
    value: state.resolveTyped[key] || "",
    "data-confirm-key": key,
    "aria-label": `${label}: type the sandbox name to confirm`,
    oninput: () => {
      state.resolveTyped[key] = input.value;
      confirm.disabled = input.value !== sandbox;
    },
  });
  return h("div", { class: "actions" }, [
    h("span", { class: "muted", text: "Typed confirmation:" }),
    input,
    confirm,
    h("button", {
      text: "Cancel",
      onclick: () => {
        state.resolveConfirm[sandbox] = null;
        delete state.resolveTyped[key];
        onUpdate();
      },
    }),
  ]);
}

/** Moves focus back to a typed-confirmation input after `container` was rebuilt. */
export function restoreConfirmFocus(container, key) {
  if (!key) return;
  for (const input of container.querySelectorAll("input[data-confirm-key]")) {
    if (input.getAttribute("data-confirm-key") !== key) continue;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return;
  }
}

/** The focused typed-confirmation input's key, or null. */
export function focusedConfirmKey() {
  const active = document.activeElement;
  return active && active.getAttribute ? active.getAttribute("data-confirm-key") : null;
}

function headerPath(rest) {
  // `diff --git a/X b/X`: the two names are equal, so split in the middle.
  if (rest.length % 2 === 1) {
    const half = (rest.length - 3) / 2;
    const left = rest.slice(0, half);
    if (rest.slice(half) === ` b/${left}`) return left;
  }
  const quoted = /^"a\/(.*)" "b\/(.*)"$/.exec(rest);
  if (quoted) return quoted[2];
  const plain = /^(.*) b\/(.*)$/.exec(rest);
  return plain ? plain[2] : null;
}

/**
 * The files a patch touches, from its `diff --git a/<path> b/<path>` headers,
 * falling back to `+++ b/<path>` lines for a patch without them.
 */
export function touchedFiles(text) {
  const fromHeaders = [];
  const fromPlus = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git a/") || line.startsWith('diff --git "a/')) {
      const rest = line.slice("diff --git ".length);
      const path = headerPath(rest.startsWith('"') ? rest : rest.slice(2));
      if (path && !fromHeaders.includes(path)) fromHeaders.push(path);
    } else if (line.startsWith("+++ b/")) {
      const path = line.slice("+++ b/".length).replace(/\t.*$/, "");
      if (path && !fromPlus.includes(path)) fromPlus.push(path);
    }
  }
  return fromHeaders.length ? fromHeaders : fromPlus;
}
