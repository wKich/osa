// API access.

import { showError } from "./banner.js";
import { state } from "./state.js";

export async function request(path, options) {
  const init = { method: (options && options.method) || "GET", headers: {} };
  if (options && options.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  if (options && options.token) init.headers["x-dashboard-token"] = state.token || "";
  const response = await fetch(path, init);
  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }
  if (!response.ok) {
    const raw = data && data.error ? data.error : {};
    const error = new Error(raw.message || `request failed with HTTP ${response.status}`);
    error.kind = raw.kind || "http";
    error.detail = raw.detail || "";
    throw error;
  }
  return data;
}

export async function mutate(path, body) {
  try {
    return await request(path, { method: "POST", body: body, token: true });
  } catch (error) {
    showError(error);
    throw error;
  }
}
