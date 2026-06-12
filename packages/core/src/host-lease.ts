import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { AnnotationTutorError } from "@annotation-tutor/domain";
import { VaultPaths } from "./paths.js";

export type HostOwner = "plugin" | "cli";

export type HostLeaseRecord = {
  owner: HostOwner;
  pid: number;
  acquiredAt: string;
};

export class HostLease {
  private readonly lockPath: string;
  private held = false;

  public constructor(
    paths: VaultPaths,
    private readonly owner: HostOwner
  ) {
    this.lockPath = path.join(paths.state, "write-host.lock");
  }

  public async acquire(): Promise<HostLeaseRecord> {
    await mkdir(path.dirname(this.lockPath), { recursive: true });
    const record: HostLeaseRecord = {
      owner: this.owner,
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    };
    try {
      const handle = await open(this.lockPath, "wx");
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.close();
      this.held = true;
      return record;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        const current = await this.current();
        if (current && !isProcessRunning(current.pid)) {
          await rm(this.lockPath, { force: true });
          return this.acquire();
        }
        throw new AnnotationTutorError(
          "CONFLICT",
          `Vault write host is already owned by ${current?.owner ?? "another process"}`,
          409
        );
      }
      throw error;
    }
  }

  public async current(): Promise<HostLeaseRecord | null> {
    try {
      return JSON.parse(await readFile(this.lockPath, "utf8")) as HostLeaseRecord;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  public async release(): Promise<void> {
    if (!this.held) return;
    const current = await this.current();
    if (current?.pid === process.pid && current.owner === this.owner) {
      await rm(this.lockPath, { force: true });
    }
    this.held = false;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

