// The journeys' MCP fixture as each side configures it (a journey with
// `mcp: true`): the server script and Maki's config naming it.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** the journeys' stdio MCP server (mcp-server.ts) */
export const MCP_SERVER = join(dirname(fileURLToPath(import.meta.url)), "mcp-server.ts");

/** Maki's MCP config naming the journey server (maki-agent mcp/config.rs v0.6.4) */
export function journeyMcpToml(server: string): string {
  return `[mcp.journey]\ncommand = ["bun", ${JSON.stringify(server)}]\nenabled = true\n`;
}
