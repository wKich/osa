// A minimal GitLab API stand-in for the publishing tests.
export interface FakeMR {
  iid: number;
  project: string;
  title: string;
  description: string;
  source_branch: string;
  target_branch: string;
  labels: string;
  assignee_id?: number;
  reviewer_ids?: number[];
  web_url: string;
  state: string;
}

export function fakeGitLab(opts: { token: string; members?: Record<string, number[]>; users?: Record<string, number>; branches?: Record<string, string[]>; lateBranches?: number }) {
  // the next N MR creations see the source branch as not there yet
  const late = { remaining: opts.lateBranches ?? 0 };
  const mrs: FakeMR[] = [];
  const seenTokens: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      seenTokens.push(req.headers.get("PRIVATE-TOKEN") ?? "");
      if (req.headers.get("PRIVATE-TOKEN") !== opts.token) return new Response('{"message":"401 Unauthorized"}', { status: 401 });
      const path = url.pathname.replace(/^\/api\/v4/, "");
      if (path === "/user") return Response.json({ id: 14134, username: "svc_kiss" });
      if (path === "/users") {
        const id = opts.users?.[url.searchParams.get("username") ?? ""];
        return Response.json(id ? [{ id }] : []);
      }
      const m = path.match(/^\/projects\/([^/]+)\/(.*)$/);
      if (!m) return new Response("{}", { status: 404 });
      const project = decodeURIComponent(m[1]!);
      const rest = m[2]!;
      const member = rest.match(/^members\/all\/(\d+)$/);
      if (member) return (opts.members?.[project] ?? []).includes(Number(member[1])) ? Response.json({}) : new Response("{}", { status: 404 });
      const branch = rest.match(/^repository\/branches\/(.+)$/);
      if (branch) return (opts.branches?.[project] ?? []).includes(decodeURIComponent(branch[1]!)) ? Response.json({}) : new Response("{}", { status: 404 });
      if (rest === "merge_requests" && req.method === "GET") {
        return Response.json(mrs.filter((x) => x.project === project && x.source_branch === url.searchParams.get("source_branch") && x.target_branch === url.searchParams.get("target_branch") && x.state === "opened"));
      }
      const one = rest.match(/^merge_requests\/(\d+)$/);
      if (one) {
        const mr = mrs.find((x) => x.project === project && x.iid === Number(one[1]));
        return mr ? Response.json(mr) : new Response("{}", { status: 404 });
      }
      if (rest === "merge_requests" && req.method === "POST" && late.remaining > 0) {
        late.remaining--;
        return Response.json({ message: { source_branch: ["does not exist"] } }, { status: 400 });
      }
      if (rest === "merge_requests" && req.method === "POST") {
        const body = (await req.json()) as Omit<FakeMR, "iid" | "project" | "web_url" | "state">;
        const mr = { ...body, state: "opened", iid: mrs.length + 1, project, web_url: `https://gitlab.test/${project}/-/merge_requests/${mrs.length + 1}` };
        mrs.push(mr);
        return Response.json(mr, { status: 201 });
      }
      return new Response("{}", { status: 404 });
    },
  });
  return { url: `http://localhost:${server.port}`, mrs, seenTokens, late, stop: () => server.stop(true) };
}
