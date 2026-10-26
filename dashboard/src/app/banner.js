// Banner and status line.

import { clear } from "./dom.js";
import { state } from "./state.js";

export function showNotice(message) {
  state.banner.className = "notice";
  state.banner.textContent = message;
}

export function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error && error.detail ? `\n${error.detail}` : "";
  state.banner.className = "error";
  state.banner.textContent = `${message}${detail}`;
}

export function clearBanner() {
  state.banner.className = "";
  state.banner.textContent = "";
}

export function renderStatus(doctor) {
  clear(state.status);
  if (!doctor) {
    state.status.append("status unavailable");
    return;
  }
  if (!doctor.cli.ok) {
    state.status.append(`CLI unavailable: ${doctor.cli.error || "openshell not found"}`);
    return;
  }
  const gateway = doctor.gateway.ok
    ? `gateway ${doctor.gateway.gateway || "connected"}`
    : `gateway unreachable`;
  const version = doctor.gateway.version || doctor.cli.version || "";
  const parts = [gateway, version, state.readOnly ? "read-only" : "read-write"];
  state.status.append(parts.filter(Boolean).join(" · "));
  if (!doctor.gateway.ok && doctor.gateway.error) {
    state.status.append(` (${doctor.gateway.error})`);
  }
}
