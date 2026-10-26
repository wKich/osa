// Patch view: a retained patch. Each line is a text node classed by its first
// characters, and the text is never editable. Outside read-only mode, Apply,
// Branch, and Drop sit under the diff, so the patch is on screen before any of
// them is pressed (design D3); Apply first lists the files it touches, and
// Drop needs the typed sandbox name.

import { request } from "./api.js";
import { showError } from "./banner.js";
import { clear, h } from "./dom.js";
import {
  disabledReason,
  focusedConfirmKey,
  outcomeView,
  projectFor,
  restoreConfirmFocus,
  runResolve,
  touchedFiles,
  typedConfirm,
} from "./resolve.js";
import { actions, state } from "./state.js";

function lineClass(line) {
  if (line.startsWith("@@")) return "patch-line patch-hunk";
  if (line.startsWith("+")) return "patch-line patch-add";
  if (line.startsWith("-")) return "patch-line patch-del";
  return "patch-line";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function openPatch(sandbox) {
  state.patchSandbox = sandbox;
  state.patch = null;
  state.patchError = null;
  actions.navigate("patch");
}

export async function loadPatch() {
  const sandbox = state.patchSandbox;
  try {
    const data = await request(`/api/projects/${encodeURIComponent(sandbox)}/patch`, { token: true });
    if (state.patchSandbox !== sandbox) return;
    state.patch = data.patch;
  } catch (error) {
    state.patchError = error;
    showError(error);
  }
  if (state.view === "patch") actions.render();
}

function applyConfirmation(sandbox, patch) {
  const files = touchedFiles(patch.text);
  return h("div", { class: "card" }, [
    h("p", { text: `Apply writes these files in the project's working tree, without staging or committing:` }),
    files.length
      ? h("ul", { id: "apply-files" }, files.map((file) => h("li", null, h("code", { text: file }))))
      : h("p", { class: "muted", text: "No file headers found in the patch." }),
    patch.truncated
      ? h("p", { class: "warn", text: "Incomplete: the patch was truncated, so this list may miss files. Apply still uses the whole patch." })
      : null,
    h("div", { class: "actions" }, [
      h("button", { text: "Confirm apply", onclick: () => runResolve(sandbox, "apply", updatePatchActions) }),
      h("button", {
        text: "Cancel",
        onclick: () => {
          state.resolveConfirm[sandbox] = null;
          updatePatchActions();
        },
      }),
    ]),
  ]);
}

function patchActions() {
  const sandbox = state.patchSandbox;
  const project = projectFor(sandbox);
  const nodes = [];
  const retained = project && project.pending === "retained" && !project.orphan;
  if (!state.readOnly && retained && state.patch) {
    const reason = disabledReason(project);
    const confirming = reason ? null : state.resolveConfirm[sandbox];
    const toggle = (action) => () => {
      state.resolveConfirm[sandbox] = confirming === action ? null : action;
      updatePatchActions();
    };
    nodes.push(
      h("div", { class: "actions" }, [
        h("button", { text: "Apply", disabled: Boolean(reason), onclick: toggle("apply") }),
        h("button", {
          text: "Branch",
          disabled: Boolean(reason),
          title: "Commit the patch on a new osa/<sandbox>-<timestamp> branch at the session's base",
          onclick: () => runResolve(sandbox, "branch", updatePatchActions),
        }),
        h("button", { class: "danger", text: "Drop", disabled: Boolean(reason), onclick: toggle("drop") }),
        reason ? h("span", { class: "muted", text: reason }) : null,
      ]),
    );
    if (confirming === "apply") nodes.push(applyConfirmation(sandbox, state.patch));
    if (confirming === "drop") nodes.push(typedConfirm(sandbox, "drop", updatePatchActions));
  }
  nodes.push(outcomeView(sandbox));
  return nodes;
}

/** Re-renders only the actions under the diff, never the patch text. */
export function updatePatchActions() {
  const container = document.getElementById("patch-actions");
  if (!container) return;
  const focused = focusedConfirmKey();
  clear(container);
  for (const node of patchActions()) if (node) container.append(node);
  restoreConfirmFocus(container, focused);
}

export function renderPatch() {
  clear(state.app);
  const card = h("div", { class: "card" }, [
    h("div", { class: "row" }, [
      h("h2", { text: `Patch: ${state.patchSandbox}` }),
      h("button", { text: "← Projects", onclick: () => actions.navigate("projects") }),
    ]),
    h("p", {
      class: "muted",
      text: state.readOnly
        ? "Read-only mode. Run osa resolve or the front-end in the project to apply, branch, or drop it."
        : "Apply, Branch, and Drop are under the diff; each runs osa resolve.",
    }),
  ]);
  const patch = state.patch;
  if (!patch) {
    card.append(h("p", { class: "muted", text: state.patchError ? "Patch unavailable." : "Loading…" }));
    state.app.append(card);
    return;
  }
  card.append(h("p", null, [h("code", { text: patch.name }), h("span", { class: "muted", text: ` · ${formatSize(patch.size)}` })]));
  if (patch.truncated) {
    card.append(h("p", { class: "warn", text: `Truncated: showing the first 2 MiB of ${formatSize(patch.size)}.` }));
  }
  const view = h("div", { id: "patch-view" });
  for (const line of patch.text.split("\n")) view.append(h("div", { class: lineClass(line), text: line }));
  card.append(view, h("div", { id: "patch-actions" }));
  state.app.append(card);
  updatePatchActions();
}
