// Patch view: a retained patch, read-only. Each line is a text node classed
// by its first characters; there is no apply, branch, or drop control.

import { request } from "./api.js";
import { showError } from "./banner.js";
import { clear, h } from "./dom.js";
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

export function renderPatch() {
  clear(state.app);
  const card = h("div", { class: "card" }, [
    h("div", { class: "row" }, [
      h("h2", { text: `Patch: ${state.patchSandbox}` }),
      h("button", { text: "← Projects", onclick: () => actions.navigate("projects") }),
    ]),
    h("p", { class: "muted", text: "Read-only. Run the front-end in the project to apply, branch, or drop it." }),
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
  card.append(view);
  state.app.append(card);
}
