// Egress tests: the OCSF shorthand denial parser over the recorded real line
// shapes, grouping, endpoint splitting, and the spec's proposal match rule.

import { describe, expect, test } from "bun:test";
import {
  DenialCache,
  groupDenials,
  groupMatchesProposal,
  matchDenials,
  proposalEndpoints,
  scanDenials,
  unmatchedCount,
  type DenialGroup,
} from "../src/egress.ts";
import { parseDenialLine, type DenialEvent, type RuleProposal } from "../src/openshell.ts";

const ESC = "\u001b";

describe("parseDenialLine", () => {
  const cases: Array<{ name: string; line: string; expected: unknown }> = [
    {
      name: "flow shape with pid and reason (real)",
      line: "[1792686433.775] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(0) -> example.com:443 [reason:transparent_tcp_policy_denied]",
      expected: {
        kind: "denial",
        event: {
          timeMs: 1792686433775,
          source: "sandbox",
          eventClass: "NET:OPEN",
          severity: "MED",
          host: "example.com",
          port: 443,
          binary: "/usr/bin/curl",
          pid: 0,
          reason: "transparent_tcp_policy_denied",
        },
      },
    },
    {
      name: "host-only shape (real)",
      line: "[1792686433.774] [sandbox] [OCSF ] [ocsf] NET:REFUSE [MED] DENIED example.com [reason:policy_dns_ineligible]",
      expected: {
        kind: "denial",
        event: {
          timeMs: 1792686433774,
          source: "sandbox",
          eventClass: "NET:REFUSE",
          severity: "MED",
          host: "example.com",
          port: null,
          binary: null,
          pid: null,
          reason: "policy_dns_ineligible",
        },
      },
    },
    {
      name: "upstream policy/engine tags carry no reason",
      line: "[1759622400.500] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(58) -> api.example.com:443 [policy:- engine:opa]",
      expected: {
        kind: "denial",
        event: expect.objectContaining({ host: "api.example.com", port: 443, binary: "/usr/bin/curl", pid: 58, reason: null }),
      },
    },
    {
      name: "flow without a pid",
      line: "[1.5] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/local/bin/opencode -> models.opencode.ai:443",
      expected: {
        kind: "denial",
        event: expect.objectContaining({ host: "models.opencode.ai", port: 443, binary: "/usr/local/bin/opencode", pid: null }),
      },
    },
    {
      name: "IPv6 destination",
      line: "[1.6] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(70) -> [2001:db8::1]:8443 [reason:transparent_tcp_policy_denied]",
      expected: {
        kind: "denial",
        event: expect.objectContaining({ host: "2001:db8::1", port: 8443, binary: "/usr/bin/curl" }),
      },
    },
    {
      name: "ANSI colors are stripped",
      line: `${ESC}[33m[1.8] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED${ESC}[0m /usr/bin/git(80) -> github.com:443 [reason:x]`,
      expected: {
        kind: "denial",
        event: expect.objectContaining({ host: "github.com", port: 443, binary: "/usr/bin/git", reason: "x" }),
      },
    },
    {
      name: "markup in the host stays a string",
      line: "[1.9] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(81) -> <img src=x onerror=alert(1)>:443 [reason:x]",
      expected: {
        kind: "denial",
        event: expect.objectContaining({ host: "<img src=x onerror=alert(1)>", port: 443 }),
      },
    },
    {
      name: "OCSF non-denial is skipped",
      line: "[1.2] [sandbox] [OCSF ] [ocsf] CONFIG:OBSERVATION [INFO] Policy DNS staged unapproved name example.com synthetic=198.18.0.2 for TCP policy review",
      expected: { kind: "skip" },
    },
    {
      name: "allowed flow is skipped",
      line: "[1.3] [sandbox] [OCSF ] [ocsf] NET:OPEN [INFO] ALLOWED /usr/bin/curl(71) -> base.example.com:443 [policy:stub_base_rule engine:opa]",
      expected: { kind: "skip" },
    },
    {
      name: "non-OCSF line that says DENIED is skipped",
      line: "[1.4] [sandbox] [INFO ] [supervisor] DENIED is only a word in this line",
      expected: { kind: "skip" },
    },
    {
      name: "non-NET OCSF denial is unparsed",
      line: "[1.7] [sandbox] [OCSF ] [ocsf] HTTP:GET [MED] DENIED GET https://api.example.com/v1/secret [policy:- engine:l7]",
      expected: {
        kind: "unparsed",
        raw: "[1.7] [sandbox] [OCSF ] [ocsf] HTTP:GET [MED] DENIED GET https://api.example.com/v1/secret [policy:- engine:l7]",
      },
    },
    {
      name: "NET denial in an unknown layout is unparsed",
      line: "[1.7] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED curl to example.com port 443",
      expected: { kind: "unparsed", raw: "[1.7] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED curl to example.com port 443" },
    },
    {
      name: "flow with a non-numeric port is unparsed",
      line: "[1.7] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(1) -> example.com:https",
      expected: { kind: "unparsed", raw: "[1.7] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(1) -> example.com:https" },
    },
    {
      name: "OCSF denial without the shorthand prefix is unparsed",
      line: "[OCSF ] DENIED something new",
      expected: { kind: "unparsed", raw: "[OCSF ] DENIED something new" },
    },
  ];

  for (const entry of cases) {
    test(entry.name, () => {
      expect(parseDenialLine(entry.line)).toEqual(entry.expected as never);
    });
  }
});

function event(overrides: Partial<DenialEvent>): DenialEvent {
  return {
    timeMs: 1000,
    source: "sandbox",
    eventClass: "NET:OPEN",
    severity: "MED",
    host: "example.com",
    port: 443,
    binary: "/usr/bin/curl",
    pid: 1,
    reason: null,
    ...overrides,
  };
}

function proposal(overrides: Partial<RuleProposal>): RuleProposal {
  return {
    chunkId: "chunk-1",
    status: "pending",
    ruleName: "allow",
    binary: null,
    confidence: null,
    rationale: null,
    securityNotes: null,
    prover: null,
    applicationError: null,
    candidateHash: null,
    endpoints: "api.example.com:443 (rest, enforce)",
    binaries: [],
    ...overrides,
  };
}

function group(overrides: Partial<DenialGroup>): DenialGroup {
  return {
    host: "api.example.com",
    port: 443,
    binary: "/usr/bin/curl",
    count: 1,
    firstSeen: 1,
    lastSeen: 1,
    reasons: [],
    matches: [],
    ...overrides,
  };
}

describe("groupDenials", () => {
  test("spec scenario: three curl flows and one DNS refusal give two groups", () => {
    const events = [
      event({ timeMs: 1000, reason: "transparent_tcp_policy_denied" }),
      event({ timeMs: 3000, reason: "transparent_tcp_policy_denied" }),
      event({ timeMs: 2000, reason: "transparent_tcp_policy_denied" }),
      event({ timeMs: 1500, port: null, binary: null, pid: null, reason: "policy_dns_ineligible" }),
    ];
    const groups = groupDenials(events);
    expect(groups).toHaveLength(2);
    const flow = groups.find((entry) => entry.port === 443)!;
    expect(flow).toMatchObject({ host: "example.com", binary: "/usr/bin/curl", count: 3, firstSeen: 1000, lastSeen: 3000 });
    expect(flow.reasons).toEqual(["transparent_tcp_policy_denied"]);
    const dns = groups.find((entry) => entry.port === null)!;
    expect(dns).toMatchObject({ host: "example.com", binary: null, count: 1, reasons: ["policy_dns_ineligible"] });
  });

  test("host case folds into one group; distinct reasons are collected", () => {
    const groups = groupDenials([
      event({ host: "Example.COM", reason: "a" }),
      event({ host: "example.com", reason: "b" }),
      event({ host: "example.com", reason: "a" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ host: "example.com", count: 3, reasons: ["a", "b"] });
  });

  test("different binaries and ports are separate groups", () => {
    const groups = groupDenials([
      event({ binary: "/usr/bin/curl" }),
      event({ binary: "/usr/bin/node" }),
      event({ port: 80 }),
    ]);
    expect(groups).toHaveLength(3);
  });
});

describe("proposalEndpoints", () => {
  test("splits comma-separated items and takes the leading host:port", () => {
    expect(proposalEndpoints("API.example.com:443 (rest, enforce), other.example.com:80 (l4)")).toEqual([
      { host: "api.example.com", port: 443 },
      { host: "other.example.com", port: 80 },
    ]);
  });

  test("an item without a port has a null port", () => {
    expect(proposalEndpoints("api.example.com (rest)")).toEqual([{ host: "api.example.com", port: null }]);
  });

  test("a malformed item is skipped, the rest kept", () => {
    expect(proposalEndpoints("???, :443, api.example.com:443")).toEqual([{ host: "api.example.com", port: 443 }]);
    expect(proposalEndpoints("")).toEqual([]);
    expect(proposalEndpoints(null)).toEqual([]);
  });
});

describe("groupMatchesProposal", () => {
  test("host matches case-insensitively", () => {
    expect(groupMatchesProposal(group({ host: "API.Example.com" }), proposal({ endpoints: "api.EXAMPLE.com:443" }))).toBe(true);
  });

  test("a group without a port matches the host", () => {
    expect(groupMatchesProposal(group({ port: null, binary: null }), proposal({}))).toBe(true);
  });

  test("a different port does not match", () => {
    expect(groupMatchesProposal(group({ port: 80 }), proposal({}))).toBe(false);
  });

  test("a different host does not match", () => {
    expect(groupMatchesProposal(group({ host: "example.com" }), proposal({}))).toBe(false);
  });

  test("spec scenario: binary mismatch does not match", () => {
    expect(
      groupMatchesProposal(group({ binary: "/usr/bin/curl" }), proposal({ binaries: ["/usr/bin/node"] })),
    ).toBe(false);
    expect(
      groupMatchesProposal(group({ binary: "/usr/bin/curl" }), proposal({ binary: "/usr/bin/node" })),
    ).toBe(false);
  });

  test("binary is ignored when either side names none", () => {
    expect(groupMatchesProposal(group({ binary: null }), proposal({ binaries: ["/usr/bin/node"] }))).toBe(true);
    expect(groupMatchesProposal(group({ binary: "/usr/bin/curl" }), proposal({ binaries: [] }))).toBe(true);
  });

  test("a malformed endpoint string matches nothing", () => {
    expect(groupMatchesProposal(group({}), proposal({ endpoints: "not an endpoint list ???" }))).toBe(false);
    expect(groupMatchesProposal(group({}), proposal({ endpoints: null }))).toBe(false);
  });
});

describe("scan, match, and cache", () => {
  const lines = [
    "[1.1] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(1) -> api.example.com:443 [reason:x]",
    "[1.2] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(1) -> example.com:443 [reason:x]",
    ...Array.from({ length: 7 }, (_, i) => `[2.${i}] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED odd layout ${i}`),
    "[3.0] [gateway] [INFO ] [x] unrelated",
  ];

  test("scanDenials counts unparsed lines and keeps five samples", () => {
    const scan = scanDenials("1h", { lines, capped: false }, 42);
    expect(scan.groups).toHaveLength(2);
    expect(scan.unparsed).toBe(7);
    expect(scan.unparsedSamples).toHaveLength(5);
    expect(scan.readAt).toBe(42);
  });

  test("multiple proposals can match one group; unmatched count follows", () => {
    const scan = scanDenials("1h", { lines, capped: false }, 42);
    const matched = matchDenials(scan, [
      proposal({ chunkId: "a" }),
      proposal({ chunkId: "b", endpoints: "api.example.com:443, other.example.com:443" }),
    ]);
    const api = matched.groups.find((entry) => entry.host === "api.example.com")!;
    expect(api.matches).toEqual(["a", "b"]);
    expect(unmatchedCount(matched)).toBe(1);
    // The cached scan stays unmatched.
    expect(scan.groups.every((entry) => entry.matches.length === 0)).toBe(true);
  });

  test("the cache expires after its TTL and keeps the badge", () => {
    const cache = new DenialCache(30_000);
    const scan = scanDenials("1h", { lines, capped: false }, 1000);
    cache.put("demo", scan);
    expect(cache.get("demo", "1h", 30_999)).toBe(scan);
    expect(cache.get("demo", "1h", 31_000)).toBeNull();
    expect(cache.get("demo", "15m", 1000)).toBeNull();
    expect(cache.badge("demo")).toBeNull();
    cache.recordBadge("demo", matchDenials(scan, []));
    expect(cache.badge("demo")).toEqual({ unmatched: 2, window: "1h", readAt: 1000 });
  });
});
