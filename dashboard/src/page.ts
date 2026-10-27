// Server-rendered page shell.
//
// The page embeds a bootstrap JSON data block (session token, read-only flag,
// refresh interval, create defaults) and loads the vanilla-JS frontend from
// the ES module `/app/main.js`. No framework, no bundler, no inline script:
// the CSP only allows `script-src 'self'`.

import type { DashboardConfig } from "./config.ts";

export interface PageOptions {
  token: string | null;
  readOnly: boolean;
  refreshMs: number;
  config: DashboardConfig;
  /** True on a loopback bind, where provider setup is offered. */
  loopback?: boolean;
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderPage(options: PageOptions): string {
  const bootstrap = {
    token: options.token,
    readOnly: options.readOnly,
    refreshMs: options.refreshMs,
    loopback: options.loopback !== false,
    defaults: {
      image: options.config.image,
      policy: options.config.policy,
      providers: options.config.providers,
      cpu: options.config.cpu,
      memory: options.config.memory,
      configPath: options.config.configPath,
    },
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenShell dashboard</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 1rem 1.5rem 3rem; }
  header { display: flex; flex-wrap: wrap; gap: 1rem; align-items: baseline; justify-content: space-between; }
  h1 { font-size: 1.1rem; margin: 0; }
  h2 { font-size: 1rem; margin: 0; }
  h3 { font-size: .9rem; margin: .2rem 0 .5rem; text-transform: uppercase; letter-spacing: .04em; opacity: .8; }
  #status { margin: .75rem 0; }
  #banner:empty { display: none; }
  #banner { border: 1px solid transparent; padding: .5rem .75rem; margin: .75rem 0; white-space: pre-wrap; }
  #banner.notice { border-color: #2a7; background: rgba(40, 160, 120, .12); }
  #banner.error { border-color: #c66; background: rgba(200, 80, 80, .12); }
  .muted { opacity: .65; }
  .warn { color: #b45309; }
  table { border-collapse: collapse; width: 100%; margin: .4rem 0; }
  th, td { text-align: left; padding: .3rem .6rem; border-bottom: 1px solid rgba(128, 128, 128, .3); vertical-align: top; }
  th { font-weight: 600; }
  button { font: inherit; }
  button.link { background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; color: inherit; }
  button.active { font-weight: 700; text-decoration: underline; }
  pre { white-space: pre-wrap; word-break: break-word; }
  section[hidden] { display: none; }
  .row { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
  .card { border: 1px solid rgba(128, 128, 128, .4); padding: .6rem .8rem; margin: .5rem 0; }
  .actions { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; margin: .5rem 0; }
  .actions input { font: inherit; }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .6rem; margin: .5rem 0; }
  .field { display: flex; flex-direction: column; gap: .2rem; }
  .field input { font: inherit; }
  .log-line { white-space: pre-wrap; word-break: break-word; margin: 0; }
  .log-error { color: #c44; }
  .log-warn { color: #b45309; }
  .log-debug, .log-trace { opacity: .7; }
  #log-view { height: 24rem; overflow: auto; border: 1px solid rgba(128, 128, 128, .4); padding: .4rem; }
  nav.tabs { display: flex; gap: .6rem; align-items: baseline; }
  nav.tabs button { background: none; border: 0; padding: 0; cursor: pointer; color: inherit; }
  nav.tabs button.attention { border: 1px solid #b45309; color: #b45309; padding: 0 .4rem; }
  .badge { display: inline-block; border: 1px solid currentColor; padding: 0 .35rem; margin-right: .3rem; font-size: .85em; }
  .badge-retained, .badge-parked { color: #b45309; }
  .badge-orphan { color: #c44; }
  .badge-denied { color: #c44; }
  .badge-denied-none { opacity: .65; }
  h4 { font-size: .85rem; margin: .6rem 0 .2rem; }
  .denials-row > td { padding-left: 2rem; }
  .idle-counting { color: #b45309; }
  .health-row > td { padding-left: 1.5rem; }
  .health-section { margin: .4rem 0; }
  pre.unparsed { max-height: 10rem; overflow: auto; border: 1px solid rgba(128, 128, 128, .4); padding: .4rem; }
  .full-status { margin-top: .3rem; }
  .resolve-outcome { margin-top: .3rem; }
  .resolve-outcome ul { margin: .2rem 0; padding-left: 1.2rem; }
  .resolve-outcome pre { margin: .2rem 0; }
  #patch-view { max-height: 40rem; overflow: auto; border: 1px solid rgba(128, 128, 128, .4); padding: .4rem; }
  .patch-line { white-space: pre-wrap; word-break: break-word; min-height: 1.2em; }
  .patch-add { color: #1a7f37; background: rgba(40, 160, 80, .12); }
  .patch-del { color: #c44; background: rgba(200, 80, 80, .12); }
  .patch-hunk { color: #6f42c1; }
  #build-log { max-height: 24rem; overflow: auto; border: 1px solid rgba(128, 128, 128, .4); padding: .4rem; margin: .4rem 0; }
  .build-status { margin: .3rem 0; }
  .wizard { border-top: 1px dashed rgba(128, 128, 128, .5); margin-top: .5rem; padding-top: .5rem; }
  .wizard select, .wizard input { font: inherit; }
  .setup-outcome { margin-top: .4rem; }
  code.command { border: 1px solid rgba(128, 128, 128, .4); padding: 0 .3rem; }
</style>
</head>
<body>
<header>
  <h1>OpenShell dashboard</h1>
  <nav class="tabs">
    <button id="tab-projects" type="button">Projects</button>
    <button id="tab-sandboxes" type="button">Sandboxes</button>
    <button id="tab-setup" type="button">Setup</button>
    <button id="attention" class="attention" type="button" hidden></button>
  </nav>
  <div id="status" class="muted">loading…</div>
</header>
<div id="banner" role="alert"></div>
<main id="app"></main>
<script id="dashboard-bootstrap" type="application/json">${escapeScriptJson(bootstrap)}</script>
<script type="module" src="/app/main.js"></script>
</body>
</html>
`;
}
