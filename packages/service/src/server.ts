import { serve, type ServerType } from "@hono/node-server";
import type { Hono } from "hono";

export type StartedServer = {
  port: number;
  close: () => Promise<void>;
};

export async function startLocalServer(
  app: Hono<any>,
  preferredPort = 37_891,
  maximumAttempts = 20
): Promise<StartedServer> {
  let lastError: unknown;
  for (let offset = 0; offset < maximumAttempts; offset += 1) {
    const port = preferredPort + offset;
    try {
      const server = await listen(app, port);
      return {
        port,
        close: () =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
      };
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "EADDRINUSE"
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

function listen(app: Hono<any>, port: number): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port },
      (info) => resolve(server)
    );
    server.once("error", reject);
  });
}
