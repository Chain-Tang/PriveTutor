import type {
  AgentRun,
  Annotation,
  AnnotationQuery,
  PermissionPolicy
} from "@annotation-tutor/domain";

export class AnnotationTutorApiClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  public async health(): Promise<{ ok: boolean; version: string }> {
    return this.request("/api/health", {}, false);
  }

  public async listAnnotations(
    query: Partial<AnnotationQuery> = {}
  ): Promise<Annotation[]> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const response = await this.request<{ annotations: Annotation[] }>(
      `/api/annotations?${search}`
    );
    return response.annotations;
  }

  public getAnnotation(id: string): Promise<Annotation> {
    return this.request(`/api/annotations/${encodeURIComponent(id)}`);
  }

  public createAnnotation(annotation: Annotation): Promise<Annotation> {
    return this.request("/api/annotations", {
      method: "POST",
      body: JSON.stringify(annotation)
    });
  }

  public updateAnnotation(
    id: string,
    patch: Partial<Annotation>
  ): Promise<Annotation> {
    return this.request(`/api/annotations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  }

  public deleteAnnotation(id: string): Promise<void> {
    return this.request(`/api/annotations/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  }

  public deleteReview(id: string): Promise<Annotation> {
    return this.request(`/api/annotations/${encodeURIComponent(id)}/review`, {
      method: "DELETE"
    });
  }

  public getPermissions(): Promise<PermissionPolicy> {
    return this.request("/api/permissions");
  }

  public updatePermissions(
    policy: Partial<PermissionPolicy>
  ): Promise<PermissionPolicy> {
    return this.request("/api/permissions", {
      method: "PATCH",
      body: JSON.stringify(policy)
    });
  }

  public async runReview(
    annotationId: string,
    provider: "opencode" | "codex",
    onProgress: (message: string) => void,
    signal?: AbortSignal
  ): Promise<Annotation> {
    const run = await this.request<AgentRun>(
      `/api/annotations/${encodeURIComponent(annotationId)}/review-runs`,
      {
        method: "POST",
        body: JSON.stringify({ provider }),
        signal
      }
    );
    const cancel = () => {
      void fetch(
        `${this.baseUrl}/api/review-runs/${encodeURIComponent(run.id)}`,
        {
          method: "DELETE",
          headers: this.headers()
        }
      );
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await fetch(
        `${this.baseUrl}/api/review-runs/${encodeURIComponent(run.id)}/events`,
        {
          headers: this.headers(),
          signal
        }
      );
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let pending = "";
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          const events = pending.split("\n\n");
          pending = events.pop() ?? "";
          for (const event of events) {
            const data = event
              .split("\n")
              .find((line) => line.startsWith("data: "))
              ?.slice(6);
            if (!data) continue;
            const parsed = JSON.parse(data) as {
              type: string;
              message?: string;
              status?: string;
            };
            if (parsed.type === "progress" && parsed.message) {
              onProgress(parsed.message);
            }
            if (parsed.type === "error") {
              throw new Error(parsed.message ?? "Agent failed");
            }
          }
        }
      }
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
    return this.getAnnotation(annotationId);
  }

  public async followUp(
    annotationId: string,
    provider: "opencode" | "codex",
    question: string
  ): Promise<Annotation> {
    return this.request(
      `/api/annotations/${encodeURIComponent(annotationId)}/review/follow-up`,
      {
        method: "POST",
        body: JSON.stringify({ provider, question })
      }
    );
  }

  private async request<T>(
    pathname: string,
    init: RequestInit = {},
    authenticate = true
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...init,
      headers: {
        ...(authenticate ? this.headers() : {}),
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers
      }
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` };
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}
