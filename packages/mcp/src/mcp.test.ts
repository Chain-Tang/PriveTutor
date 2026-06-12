import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  AnnotationIndexer,
  AnnotationStore,
  AnnotationTutorService,
  DocumentContextService,
  MemoryCellStore,
  PermissionService,
  VaultPaths
} from "@annotation-tutor/core";
import type { Annotation } from "@annotation-tutor/domain";
import { createAnnotationTutorMcpServer } from "./index.js";
import { createMcpHttpHandler } from "./index.js";

describe("Annotation Tutor MCP", () => {
  it("lists annotations and reads source context only through annotation IDs", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-mcp-"));
    const paths = new VaultPaths(vault);
    const annotations = new AnnotationStore(paths);
    const indexer = new AnnotationIndexer(paths);
    const service = new AnnotationTutorService({
      annotations,
      memoryCells: new MemoryCellStore(paths),
      documents: new DocumentContextService(paths, annotations),
      indexer,
      permissions: new PermissionService({ allowFullDocumentRead: true })
    });
    const timestamp = new Date().toISOString();
    const record: Annotation = {
      id: "ann-1",
      filePath: "Notes/topic.md",
      anchor: {
        kind: "range",
        blockId: "at-ann-1",
        generatedBlockId: true,
        selectedText: "attention",
        contextBefore: "",
        contextAfter: "",
        textHash: "sha256:test",
        start: { line: 2, column: 0, offset: 10 },
        end: { line: 2, column: 9, offset: 19 }
      },
      userNote: {
        content: "It uses several perspectives.",
        createdAt: timestamp,
        updatedAt: timestamp
      },
      status: "saved",
      tags: ["transformer"],
      concepts: ["Attention"],
      memoryCellIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await mkdir(path.dirname(paths.sourceFile(record.filePath)), { recursive: true });
    await writeFile(paths.sourceFile(record.filePath), "# Topic\n\nAttention uses projections.", "utf8");
    await service.createAnnotation(record);

    const server = createAnnotationTutorMcpServer(service);
    const client = new Client({ name: "test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const recent = await client.callTool({
      name: "list_recent_annotations",
      arguments: { limit: 10, days: 7 }
    });
    const profile = await client.callTool({
      name: "get_document_profile",
      arguments: { annotationId: "ann-1" }
    });
    const outline = await client.callTool({
      name: "get_document_outline",
      arguments: { annotationId: "ann-1" }
    });
    const tools = await client.listTools();

    expect(JSON.stringify(recent.structuredContent)).toContain("ann-1");
    expect(JSON.stringify(profile.structuredContent)).toContain("Notes/topic.md");
    expect(JSON.stringify(outline.structuredContent)).toContain("chunk-1");
    expect(JSON.stringify(outline.structuredContent)).not.toContain(
      "Attention uses projections."
    );
    expect(
      tools.tools.find((tool) => tool.name === "read_document_chunk")?.inputSchema
    ).not.toHaveProperty("properties.filePath");

    await client.close();
    await server.close();
    indexer.close();
  });

  it("creates a fresh stateless transport for every HTTP request", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-mcp-http-"));
    const paths = new VaultPaths(vault);
    const annotations = new AnnotationStore(paths);
    const indexer = new AnnotationIndexer(paths);
    const service = new AnnotationTutorService({
      annotations,
      memoryCells: new MemoryCellStore(paths),
      documents: new DocumentContextService(paths, annotations),
      indexer,
      permissions: new PermissionService()
    });
    const handler = createMcpHttpHandler(() =>
      createAnnotationTutorMcpServer(service)
    );
    const request = () =>
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0.1.0" }
          }
        })
      });

    expect((await handler(request())).status).toBe(200);
    expect((await handler(request())).status).toBe(200);
    indexer.close();
  });
});
