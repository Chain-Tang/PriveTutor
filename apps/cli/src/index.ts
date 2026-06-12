import path from "node:path";
import { Command } from "commander";
import {
  doctorVault,
  exportAnnotations,
  rebuildIndex,
  serveForeground,
  setupAgent,
  startBackground,
  status,
  stopService
} from "./commands.js";

const program = new Command()
  .name("annotation-tutor")
  .description("Local service and setup tools for Annotation Tutor")
  .version("0.1.0");

function vaultOption(command: Command): Command {
  return command.option(
    "--vault <path>",
    "Obsidian Vault path",
    process.cwd()
  );
}

vaultOption(program.command("doctor").description("Check the local installation")).action(
  async ({ vault }: { vault: string }) => {
    for (const check of await doctorVault(path.resolve(vault))) {
      console.log(`${check.ok ? "OK" : "FAIL"} ${check.message}`);
      if (!check.ok && check.action) console.log(`  ${check.action}`);
    }
  }
);

const setup = program.command("setup").description("Configure an Agent");
for (const provider of ["opencode", "codex"] as const) {
  vaultOption(setup.command(provider)).action(async ({ vault }: { vault: string }) => {
    await setupAgent(provider, path.resolve(vault));
    console.log(`Configured ${provider} for Annotation Tutor`);
  });
}

vaultOption(program.command("start").description("Start the standalone service")).action(
  async ({ vault }: { vault: string }) => {
    const pid = await startBackground(path.resolve(vault));
    console.error(`Started Annotation Tutor service (PID ${pid})`);
  }
);

vaultOption(program.command("serve").description("Run the service in the foreground"))
  .action(async ({ vault }: { vault: string }) => serveForeground(path.resolve(vault)));

vaultOption(program.command("stop").description("Stop the standalone service")).action(
  async ({ vault }: { vault: string }) => {
    console.log(
      (await stopService(path.resolve(vault)))
        ? "Stop signal sent"
        : "Annotation Tutor service is not running"
    );
  }
);

vaultOption(program.command("status").description("Show service status")).action(
  async ({ vault }: { vault: string }) => {
    const current = await status(path.resolve(vault));
    console.log(
      current.running
        ? `running owner=${current.owner} port=${current.port}`
        : "stopped"
    );
  }
);

vaultOption(program.command("export").description("Export annotations as Markdown"))
  .option("--output <path>", "Write output to a file")
  .action(async ({ vault, output }: { vault: string; output?: string }) => {
    const markdown = await exportAnnotations(path.resolve(vault));
    if (output) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path.resolve(output), markdown, "utf8");
    } else {
      process.stdout.write(markdown);
    }
  });

vaultOption(
  program.command("rebuild-index").description("Rebuild SQLite from sidecar JSON")
).action(async ({ vault }: { vault: string }) => {
  const count = await rebuildIndex(path.resolve(vault));
  console.log(`Indexed ${count} annotations`);
});

void program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
