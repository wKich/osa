// Id minting for the OpenCode-shaped ids Maki's wire does not have
// (mapping-table.md §5). Patterns are prefix-only in the 2.1.4 schemas:
// Session.ID ^ses, Session.Message.ID ^msg_, Permission.ID ^per, Event.ID ^evt_.
import { randomBytes } from "node:crypto";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function suffix(len = 22): string {
  const bytes = randomBytes(len);
  let out = "";
  for (const b of bytes) out += B58[b % B58.length]!;
  return out;
}

export const mintSession = (): string => `ses_${suffix()}`;
export const mintMessage = (): string => `msg_${suffix()}`;
export const mintPermission = (): string => `per_${suffix()}`;
export const mintEvent = (): string => `evt_${suffix(16)}`;
