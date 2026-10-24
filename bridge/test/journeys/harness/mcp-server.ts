// The journeys' stdio MCP server (a journey with `mcp: true`): one server,
// `journey`, that the reference, the offline Maki side and the live sandbox
// all configure. Newline-delimited JSON-RPC 2.0 (MCP stdio transport), no
// dependencies, so the pinned image's Bun runs it as is.
//
//   marker     returns the text `MCP-MARKER`
//   ask_color  asks the user for a color with a form (`elicitation/create`)
//              when the client advertised elicitation on `initialize`, as
//              the MCP spec requires; otherwise it says it could not ask
const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
let elicitation = false;
const pending = new Map<string | number, (result: any) => void>();
let seq = 0;

const tools = [
  { name: "marker", description: "Return the journey marker.", inputSchema: { type: "object", properties: {} } },
  { name: "ask_color", description: "Ask the user which color the journey should use.", inputSchema: { type: "object", properties: {} } },
];

async function call(name: string): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  if (name === "marker") return { content: [{ type: "text", text: "MCP-MARKER" }] };
  if (name !== "ask_color") return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
  if (!elicitation) return { content: [{ type: "text", text: "Could not ask: this client accepts no forms (no elicitation capability)." }] };
  const id = `journey-elicit-${++seq}`;
  const answer = await new Promise<any>((resolve) => {
    pending.set(id, resolve);
    write({
      jsonrpc: "2.0",
      id,
      method: "elicitation/create",
      params: {
        message: "Which color should the journey use?",
        requestedSchema: { type: "object", properties: { color: { type: "string", enum: ["red", "blue"] } }, required: ["color"] },
      },
    });
  });
  const text = answer?.action === "accept" ? `The user chose ${answer.content?.color}.` : `The user ${answer?.action ?? "declined"} the form.`;
  return { content: [{ type: "text", text }] };
}

async function handle(msg: any): Promise<void> {
  if (msg.id !== undefined && msg.method === undefined) {
    pending.get(msg.id)?.(msg.result ?? { action: "decline" });
    pending.delete(msg.id);
    return;
  }
  const reply = (result: unknown): void => {
    if (msg.id !== undefined) write({ jsonrpc: "2.0", id: msg.id, result });
  };
  switch (msg.method) {
    case "initialize":
      elicitation = Boolean(msg.params?.capabilities?.elicitation);
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "journey", version: "1.0.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools });
    case "tools/call":
      return reply(await call(String(msg.params?.name ?? "")));
    case "resources/list":
      return reply({ resources: [] });
    case "resources/templates/list":
      return reply({ resourceTemplates: [] });
    case "prompts/list":
      return reply({ prompts: [] });
    default:
      if (msg.id !== undefined) write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      void handle(JSON.parse(line));
    } catch {
      // a malformed line has no id to answer
    }
  }
});
