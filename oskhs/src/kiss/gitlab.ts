// GitLab access for publishing (B1.4, design in add-oskhs-merge-requests).
// The token lives in the oskhs host process only: the API gets it as a
// header, git as an environment-only http.extraHeader. Neither error
// messages nor logs ever include it.

export interface GitLabConfig {
  baseUrl: string; // e.g. https://git.skbkontur.ru
  token: string;
  gitBaseUrl?: string; // where repositories are fetched from; default baseUrl (tests use a local dir)
  mrRetryDelaysMs?: number[]; // default kiss's MR_CREATE_RETRY_DELAYS
}

/** kiss GitlabService: a just-pushed branch reaches the MR endpoint late (400 "source_branch does not exist"). */
export const MR_CREATE_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 45_000];

export interface MergeRequest {
  iid: number;
  web_url: string;
}

export class GitLabError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** git reads this as `-c http.extraHeader=…` without it ever touching argv. */
export function gitAuthEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`oauth2:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export const repoUrl = (cfg: GitLabConfig, projectPath: string) => `${(cfg.gitBaseUrl ?? cfg.baseUrl).replace(/\/+$/, "")}/${projectPath}.git`;

export class GitLab {
  constructor(private readonly cfg: GitLabConfig) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl.replace(/\/+$/, "")}/api/v4${path}`, {
      method,
      headers: { "PRIVATE-TOKEN": this.cfg.token, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      const detail = text.split(this.cfg.token).join("<token>").slice(0, 300);
      throw new GitLabError(`GitLab ${method} ${path.split("?")[0]} → ${res.status}: ${detail}`, res.status);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  private static project = (path: string) => encodeURIComponent(path);

  async currentUser(): Promise<{ id: number; username: string }> {
    return this.call("GET", "/user");
  }

  async userId(username: string): Promise<number | null> {
    const users = await this.call<{ id: number }[]>("GET", `/users?username=${encodeURIComponent(username)}`);
    return users[0]?.id ?? null;
  }

  async isMember(projectPath: string, userId: number): Promise<boolean> {
    try {
      await this.call("GET", `/projects/${GitLab.project(projectPath)}/members/all/${userId}`);
      return true;
    } catch (err) {
      if (err instanceof GitLabError && / → 404:/.test(err.message)) return false;
      throw err;
    }
  }

  async branchExists(projectPath: string, branch: string): Promise<boolean> {
    try {
      await this.call("GET", `/projects/${GitLab.project(projectPath)}/repository/branches/${encodeURIComponent(branch)}`);
      return true;
    } catch (err) {
      if (err instanceof GitLabError && / → 404:/.test(err.message)) return false;
      throw err;
    }
  }

  async findOpenMR(projectPath: string, source: string, target: string): Promise<MergeRequest | null> {
    const q = `state=opened&source_branch=${encodeURIComponent(source)}&target_branch=${encodeURIComponent(target)}`;
    const mrs = await this.call<MergeRequest[]>("GET", `/projects/${GitLab.project(projectPath)}/merge_requests?${q}`);
    return mrs[0] ?? null;
  }

  async mrState(projectPath: string, iid: number): Promise<string> {
    const mr = await this.call<{ state: string }>("GET", `/projects/${GitLab.project(projectPath)}/merge_requests/${iid}`);
    return mr.state;
  }

  async createMR(
    projectPath: string,
    mr: { title: string; description: string; source: string; target: string; labels: string[]; assigneeId?: number; reviewerIds?: number[] },
  ): Promise<MergeRequest> {
    const body = {
      title: mr.title,
      description: mr.description,
      source_branch: mr.source,
      target_branch: mr.target,
      labels: mr.labels.join(","),
      ...(mr.assigneeId ? { assignee_id: mr.assigneeId } : {}),
      ...(mr.reviewerIds?.length ? { reviewer_ids: mr.reviewerIds } : {}),
    };
    // kiss: retry any 400 except a moved project, which no wait fixes
    for (const delay of [...(this.cfg.mrRetryDelaysMs ?? MR_CREATE_RETRY_DELAYS_MS), null]) {
      try {
        return await this.call<MergeRequest>("POST", `/projects/${GitLab.project(projectPath)}/merge_requests`, body);
      } catch (err) {
        if (delay === null || !(err instanceof GitLabError) || err.status !== 400 || /moved projects?/i.test(err.message)) throw err;
        await Bun.sleep(delay);
      }
    }
    throw new Error("unreachable");
  }
}
