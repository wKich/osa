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
  /** Provider setup is offered only on a loopback bind. */
  loopback: bootstrap.loopback !== false,
  refreshMs: bootstrap.refreshMs || 3000,
  defaults: bootstrap.defaults || {},
  app: document.getElementById("app"),
  banner: document.getElementById("banner"),
  status: document.getElementById("status"),
  attention: document.getElementById("attention"),
  tabs: {
    projects: document.getElementById("tab-projects"),
    sandboxes: document.getElementById("tab-sandboxes"),
    setup: document.getElementById("tab-setup"),
  },
  view: "projects",
  selected: null,
  sandboxes: [],
  /** True after the last inventory poll succeeded, false after it failed, null before. */
  inventoryKnown: null,
  projects: [],
  projectsLoaded: false,
  /** Last `osa health` per sandbox name: { loading, value, error, at }. */
  health: {},
  /** The sandbox whose Health panel is open, or null. */
  healthOpen: null,
  /** The last /api/doctor reply, for re-rendering the header status. */
  doctor: null,
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
  /** Denial window for the Rules view: "15m", "1h", or "6h". */
  denialWindow: "1h",
  /** Last denials read for the selected sandbox: { key, loading, value, error }. */
  denials: null,
  policyTab: "full",
  /** `osa images` for the Setup tab: { value, loading, error }. */
  images: { value: null, loading: false, error: null },
  /** The current or last image build: its summary, replayed lines, and stream. */
  build: { summary: null, lines: [], es: null },
  /** `osa providers` for the Setup tab: { value, loading, error }. */
  providers: { value: null, loading: false, error: null },
  /**
   * The open provider wizard: { agent, sandbox, profile, name, nameEdited,
   * replace, running, outcome }, or null. Never holds the credential.
   */
  wizard: null,
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
  renderStatus: () => {},
  /** The sandbox whose last Health panel had a failing doctor check, or null. */
  failingHealth: () => null,
  /** Opens a sandbox's Health panel with its last result, running nothing. */
  showHealth: (_sandbox) => {},
  loadProviders: async () => {},
  updateProviders: () => {},
};
