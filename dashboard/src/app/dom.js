// DOM helpers: the only place DOM nodes are created.
//
// Safety invariant: gateway and project data reach the DOM only through
// `document.createTextNode` / `textContent` (the `h()` helper below). No
// module writes markup strings into element content, and a test asserts that
// no HTML sink identifier appears in any served module.

export function h(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = String(value);
      else if (key === "disabled") node.disabled = Boolean(value);
      else if (key === "value") node.value = String(value);
      else if (key === "checked") node.checked = Boolean(value);
      else if (key.indexOf("on") === 0 && typeof value === "function") {
        node.addEventListener(key.slice(2), value);
      } else if (key === "selected") node.selected = Boolean(value);
      else node.setAttribute(key, String(value));
    }
  }
  const list = Array.isArray(children) ? children : children === undefined ? [] : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function shortHash(hash) {
  return typeof hash === "string" && hash.length > 12 ? hash.slice(0, 12) : hash || "";
}

export function formatTimestamp(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "Z");
}

/** "12s ago", "3m ago", "2h ago" for a past time in milliseconds. */
export function formatAge(ms, now) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  const seconds = Math.max(0, Math.round(((now ?? Date.now()) - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/**
 * The denied-count badge from the last denials read (egress design D4), or
 * null when no read has happened: a badge never triggers a read.
 */
export function deniedBadge(denials) {
  if (!denials || typeof denials.unmatched !== "number") return null;
  return h("span", {
    class: denials.unmatched > 0 ? "badge badge-denied" : "badge badge-denied-none",
    title: `denials with no pending proposal, ${denials.window} window, read ${formatAge(denials.readAt)}`,
    text: `${denials.unmatched} denied · ${formatAge(denials.readAt)}`,
  });
}
