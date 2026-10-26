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
