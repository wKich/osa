// Shared client state: the bootstrap data from the page shell, the mounted
// DOM regions, and the per-view state every module reads and writes.
//
// Views import this module rather than main.js, so modules never import each
// other in cycles. Cross-view calls go through `actions`, which main.js fills
// in at startup.

const bootstrapElement = document.getElementById("dashboard-bootstrap");
let bootstrap = {};
try {
  bootstrap = JSON.parse(bootstrapElement ? bootstrapElement.textContent || "{}" : "{}");
} catch (_) {
  bootstrap = {};
}

export const state = {
  token: bootstrap.token ?? null,
  readOnly: Boolean(bootstrap.readOnly),
  refreshMs: bootstrap.refreshMs || 3000,
  defaults: bootstrap.defaults || {},
  app: document.getElementById("app"),
  banner: document.getElementById("banner"),
  status: document.getElementById("status"),
  attention: document.getElementById("attention"),
  tabs: {
    projects: document.getElementById("tab-projects"),
    sandboxes: document.getElementById("tab-sandboxes"),
  },
  view: "projects",
  selected: null,
  sandboxes: [],
  /** True after the last inventory poll succeeded, false after it failed, null before. */
  inventoryKnown: null,
  projects: [],
  projectsLoaded: false,
  /** Full status per sandbox name: { loading, value, error }. */
  projectStatus: {},
  /** Last resolve outcome per sandbox: { running, action, kind, changed, message, detail }. */
  resolveOutcome: {},
  /** The open confirmation per sandbox: an action name, or null. */
  resolveConfirm: {},
  /** Typed confirmation text per `sandbox:action`. */
  resolveTyped: {},
  patchSandbox: null,
  patch: null,
  patchError: null,
  detail: null,
  rules: [],
  policyTab: "full",
  logs: {
    lines: [],
    paused: false,
    source: "all",
    level: "all",
    es: null,
    ended: false,
    started: false,
  },
};

/** Cross-view actions; main.js assigns each one before the first render. */
export const actions = {
  navigate: (_view) => {},
  render: () => {},
  loadInventory: async () => {},
  openDetail: async (_name) => {},
  refreshProject: async (_hostPath) => {},
};
