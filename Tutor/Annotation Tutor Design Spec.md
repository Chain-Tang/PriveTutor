> [!IMPORTANT]
> **Status note (2026-06-07):** This document is the original broad product
> design baseline, not an exact description of the current implementation.
> The active full MVP uses sidecar JSON, generated Markdown, SQLite/FTS, REST,
> MCP, a CLI, and an Obsidian plugin. OpenCode and Codex are implemented;
> Claude Code integration, OpenAPI, mobile/web clients, direct model APIs,
> learning reflection, cloud sync, and vector retrieval are not part of the
> current MVP. `TutorLite` is a separate Markdown-only sibling implementation.
> Current verification, feature status, and release gaps are tracked in
> [`../docs/project-status.md`](../docs/project-status.md).


## 1. Project Overview

### 1.1 Project Name

**Annotation Tutor**

### 1.2 One-line Description

Annotation Tutor is a local-first annotation and learning-memory system for Obsidian. It allows learners to annotate Markdown documents, write their own understanding, expose those annotations to agents such as OpenCode, Codex, and Claude Code, and optionally receive agent-generated review, memory cells, and learning reflections.

### 1.3 Core Product Statement

The system should not make AI read for the user.  
The system should help AI understand how the user reads.

### 1.4 Primary Principle

Annotations are not just UI comments.  
Annotations are the smallest unit of agent-readable learning memory.

---

## 2. Target Users

### 2.1 Primary Users

- Students
    
- Self-learners
    
- Researchers
    
- Paper readers
    
- Markdown-heavy learners
    
- Obsidian users
    
- Users who want low-cost AI assistance through local or open-source agents
    

### 2.2 Secondary Users

- Developers building Android, iOS, Web, or desktop clients
    
- Agent workflow builders
    
- Educators
    
- Open-source contributors
    

---

## 3. Product Principles

### 3.1 Agent-first

The default user path should not require the user to configure an AI model API key inside Obsidian.

The Obsidian plugin is responsible for:

- Creating annotations
    
- Rendering annotation marks
    
- Maintaining an annotation index
    
- Exposing local data through API and MCP
    
- Exporting agent-readable Markdown context
    
- Receiving agent review results
    

The agent is responsible for:

- Reasoning
    
- Reviewing user understanding
    
- Generating feedback
    
- Creating memory cells
    
- Updating learning context when permitted
    

### 3.2 API-native

All core capabilities must be available through a local API.

This is required so that future clients can be built, including:

- Android app
    
- iOS app
    
- Web dashboard
    
- Browser extension
    
- VS Code extension
    
- Zotero integration
    
- Independent PDF/Markdown reader
    

### 3.3 Local-first

All user data should be stored locally by default.

The system must not require cloud storage.

The system must not upload annotations, learning profiles, or memory cells unless the user explicitly enables an external integration.

### 3.4 Beginner-friendly

The main onboarding path must be understandable to non-developers.

The user should not be forced to understand:

- API keys
    
- Base URLs
    
- Model names
    
- JSON config files
    
- MCP configuration syntax
    
- CLI commands
    

Advanced users may access those options, but they should not be the default path.

### 3.5 Modular

The following features must be optional:

- Direct model API integration
    
- Learning profile
    
- Weekly learning reflection
    
- Spaced review
    
- Mascot or skin system
    
- Cloud sync
    
- Advanced vector retrieval
    

### 3.6 Assessment-optional

Learning assessment must not be forced on users.

Some students may feel pressure from scores, rankings, and evaluation reports. Therefore, the default experience should support annotation and agent review without requiring a learning profile.

The system may provide a gentle learning reflection mode, but it must be opt-in.

---

## 4. System Architecture

### 4.1 High-level Architecture

```text
Annotation Tutor
├── Core Engine
│   ├── Annotation Store
│   ├── Anchor Resolver
│   ├── SQLite Index
│   ├── Memory Cell Store
│   └── Learning Context Generator
│
├── Local Service
│   ├── REST API
│   ├── MCP Server
│   ├── Health Check
│   └── Optional WebSocket/SSE Events
│
├── Clients
│   ├── Obsidian Plugin
│   ├── Future Web Dashboard
│   ├── Future Android App
│   └── Future iOS App
│
├── Agent Integrations
│   ├── OpenCode Pack
│   ├── Codex Plugin Pack
│   ├── Claude Code Instructions
│   ├── AGENTS.md
│   └── SKILL.md
│
└── Optional Modules
    ├── Direct Model API
    ├── Learning Reflection
    ├── Spaced Review
    ├── Mascot / Skin System
    └── Cloud Sync
```

### 4.2 Two Main Interfaces

Annotation Tutor must expose two interfaces.

#### Interface A: Agent Interface

Used by OpenCode, Codex, Claude Code, and other agents.

Includes:

- MCP tools
    
- Agent skills
    
- AGENTS.md
    
- Agent setup wizard
    
- Agent write-back permissions
    

Purpose:

- Help non-technical learners use the system without configuring model APIs manually.
    

#### Interface B: Native API Interface

Used by developers and future clients.

Includes:

- Local REST API
    
- OpenAPI schema
    
- SDK-ready endpoints
    
- Local development token
    

Purpose:

- Enable Android, iOS, Web, desktop, and third-party clients.
    

---

## 5. Required MVP Scope

The MVP must include the following features.

### 5.1 Annotation Creation

The user must be able to:

- Select text in a Markdown document
    
- Create an annotation
    
- Write their own understanding
    
- Save the annotation locally
    
- See the annotation rendered as underline, highlight, gutter icon, or equivalent mark
    

### 5.2 Annotation Dashboard

The user must be able to open a global dashboard without opening a specific document.

The dashboard must show:

- All annotations
    
- Source Markdown file
    
- Selected text snippet
    
- User note
    
- Status
    
- Concepts/tags if available
    
- Creation time
    
- Review state
    
- Memory cell state
    

The user must be able to click an annotation and jump back to the source Markdown location.

### 5.3 Local Storage

The system must store data locally using:

- Lightweight Markdown anchors in source documents
    
- Sidecar JSON files for annotation details
    
- SQLite index for fast search
    
- Markdown/YAML files for memory cells and agent context
    

### 5.4 Local REST API

The MVP must expose a local REST API for reading and writing annotations.

### 5.5 Local MCP Server

The MVP must expose MCP tools for agents.

At minimum, the MCP server must support:

- `list_recent_annotations`
    
- `search_annotations`
    
- `get_annotation_detail`
    
- `get_recent_learning_context`
    
- `write_agent_review`
    
- `create_memory_cell`
    

### 5.6 OpenCode Integration

OpenCode integration is a core requirement.

The system must provide:

- OpenCode setup command
    
- OpenCode MCP config generation
    
- OpenCode Skill file
    
- Connection health check
    

### 5.7 Agent Write-back

Agents must be able to write review results back into an annotation, with user permission.

The MVP must support writing:

- Correctness state
    
- Review summary
    
- Strengths
    
- Weaknesses
    
- Suggested revision
    
- Socratic question
    
- Optional memory cell candidate
    

### 5.8 Beginner Onboarding

The MVP must include a beginner-friendly onboarding flow.

The first-run wizard must offer:

1. Use annotations only
    
2. Connect with OpenCode
    
3. Developer API mode
    

Direct model API setup must not be the default path.

---

## 6. Explicit Non-goals for MVP

The MVP must not require:

- Cloud account
    
- Model API key
    
- Vector database
    
- Learning score
    
- Skin marketplace
    
- Mobile app
    
- Team collaboration
    
- Cloud sync
    
- Full knowledge graph
    

These may be added later as optional modules.

---

## 7. Data Model

### 7.1 Annotation

An annotation represents a user-created note anchored to a text span in a Markdown document.

```ts
type Annotation = {
  id: string;
  filePath: string;

  anchor: {
    blockId: string;
    selectedText: string;
    contextBefore?: string;
    contextAfter?: string;
    textHash?: string;
    startOffset?: number;
    endOffset?: number;
  };

  userNote: {
    content: string;
    createdAt: string;
    updatedAt: string;
  };

  status: "draft" | "saved" | "review_requested" | "reviewed" | "archived";

  review?: AgentReview;

  tags?: string[];
  concepts?: string[];

  memoryCellIds?: string[];

  createdAt: string;
  updatedAt: string;
};
```

### 7.2 Agent Review

An agent review is feedback generated by an external agent or direct model integration.

```ts
type AgentReview = {
  source: "opencode" | "codex" | "claude-code" | "direct-api" | "manual";

  correctness: "correct" | "partially_correct" | "incorrect" | "uncertain";

  score?: number;

  summary: string;

  strengths?: string[];

  weaknesses?: string[];

  missingConcepts?: string[];

  suggestedRevision?: string;

  socraticQuestion?: string;

  createdAt: string;
};
```

### 7.3 Memory Cell

A memory cell is a durable learning-memory object generated from one or more annotations.

```ts
type MemoryCell = {
  id: string;

  type:
    | "conceptual_understanding"
    | "conceptual_weakness"
    | "question"
    | "learning_pattern"
    | "review_item";

  source: {
    annotationId?: string;
    filePath?: string;
  };

  concept?: {
    name: string;
    domain?: string;
  };

  summary: string;

  evidence?: string;

  userUnderstanding?: string;

  agentGuidance?: string;

  confidence?: number;

  importance?: number;

  createdAt: string;
  updatedAt: string;
};
```

### 7.4 Recent Learning Context

This is a compressed Markdown/JSON summary intended for agents.

```ts
type RecentLearningContext = {
  recentlyStudied: string[];
  activeConfusions: string[];
  highValueAnnotations: string[];
  suggestedAgentBehavior: string[];
  updatedAt: string;
};
```

---

## 8. Storage Design

### 8.1 Source Markdown

Source Markdown should contain only lightweight anchors.

Example:

```md
Multi-head attention allows the model to jointly attend to information from different representation subspaces. ^ann-20260606-001
```

Alternative:

```md
==Multi-head attention allows the model...== <!-- ann:ann-20260606-001 -->
```

The implementation should prefer a method that is:

- Human-readable
    
- Git-friendly
    
- Robust under editing
    
- Easy to rebuild from
    

### 8.2 Sidecar JSON

Full annotation records should be stored outside the source document.

Recommended path:

```text
.obsidian/plugins/annotation-tutor/annotations/
```

Example file:

```json
{
  "id": "ann-20260606-001",
  "filePath": "Papers/Attention is All You Need.md",
  "anchor": {
    "blockId": "ann-20260606-001",
    "selectedText": "Multi-head attention allows the model...",
    "contextBefore": "Instead of performing a single attention function...",
    "contextAfter": "Multi-head attention also allows the model...",
    "textHash": "sha256:xxxx"
  },
  "userNote": {
    "content": "我的理解是，多头注意力就是从多个角度看同一句话。",
    "createdAt": "2026-06-06T10:00:00-04:00",
    "updatedAt": "2026-06-06T10:00:00-04:00"
  },
  "status": "reviewed",
  "review": {
    "source": "opencode",
    "correctness": "partially_correct",
    "score": 0.72,
    "summary": "理解方向正确，但缺少 Q/K/V 投影子空间的解释。",
    "weaknesses": [
      "没有解释不同 head 的不同线性投影",
      "没有解释 concat 和 output projection"
    ],
    "socraticQuestion": "如果多个 head 只是重复看同一句话，为什么需要不同的 Wq/Wk/Wv？",
    "createdAt": "2026-06-06T10:10:00-04:00"
  },
  "tags": ["transformer", "attention"],
  "concepts": ["Multi-head Attention"],
  "memoryCellIds": ["mem-20260606-001"],
  "createdAt": "2026-06-06T10:00:00-04:00",
  "updatedAt": "2026-06-06T10:10:00-04:00"
}
```

### 8.3 SQLite Index

SQLite is used for speed, not as the only source of truth.

Recommended path:

```text
.obsidian/plugins/annotation-tutor/index.sqlite
```

Core tables:

```sql
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  selected_text TEXT,
  user_note TEXT,
  review_summary TEXT,
  status TEXT,
  correctness TEXT,
  score REAL,
  tags TEXT,
  concepts TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE memory_cells (
  id TEXT PRIMARY KEY,
  source_annotation_id TEXT,
  source_file TEXT,
  concept TEXT,
  memory_type TEXT,
  summary TEXT,
  evidence TEXT,
  confidence REAL,
  importance REAL,
  created_at TEXT,
  updated_at TEXT
);
```

The system must provide a rebuild-index command.

### 8.4 Memory Cell Files

Recommended path:

```text
Learning Memory/memory-cells/
```

Recommended format: YAML or Markdown with YAML frontmatter.

Example:

```yaml
id: mem-20260606-001
type: conceptual_understanding
source:
  annotation_id: ann-20260606-001
  file: Papers/Attention is All You Need.md
concept:
  name: Multi-head Attention
  domain: AI / Transformer
summary: 用户理解了多视角直觉，但对 Q/K/V 投影机制仍不稳定。
agent_guidance: 下次讨论 attention 时，先让用户解释 Q/K/V 的分工。
confidence: 0.78
importance: 0.83
created_at: 2026-06-06
updated_at: 2026-06-06
```

### 8.5 Agent Context Markdown

Recommended path:

```text
Agent Context/recent-learning.md
```

Example:

```md
# Recent Learning Context

## Recently Studied

- Multi-head Attention
- Obsidian Plugin Development
- Agent Memory
- MCP Server

## Active Confusions

- Q/K/V projection 的必要性
- Memory Cell 和普通向量检索的区别
- MCP 和 REST API 的职责边界

## High-value Annotations

- ann-20260606-001: Multi-head Attention，部分理解正确
- ann-20260606-002: Annotation Router，设计价值较高

## Suggested Agent Behavior

- 先让用户复述理解，再进行纠错。
- 对系统设计问题，帮助用户压缩 MVP。
- 引用批注时说明来源 Markdown 文件。
```

---

## 9. Anchor Resolution

### 9.1 Requirement

The system must be able to jump from an annotation to the original Markdown location.

### 9.2 Anchor Strategy

Each annotation should store:

- Annotation ID
    
- Source file path
    
- Selected text
    
- Context before
    
- Context after
    
- Optional block ID
    
- Optional text hash
    
- Optional offsets
    

### 9.3 Fuzzy Repair

If the original anchor cannot be found, the system should attempt fuzzy matching using:

1. Exact block ID
    
2. Exact selected text
    
3. Selected text plus context before/after
    
4. Text hash
    
5. Similar text matching
    

If a likely match is found, the user should be asked whether to repair the anchor.

---

## 10. Obsidian Plugin UI

### 10.1 Ribbon Icon

The plugin must add a left ribbon icon.

Clicking it opens the Annotation Dashboard.

### 10.2 Editor Commands

The plugin must provide commands:

- Create annotation from selection
    
- Open annotation dashboard
    
- Toggle annotation marks
    
- Rebuild annotation index
    
- Start local service
    
- Run setup wizard
    

### 10.3 Context Menu

When the user selects text, the context menu should include:

- Add Annotation
    
- Add Annotation and Ask Agent Later
    
- Add Annotation Without Review
    

### 10.4 Annotation Panel

The annotation panel must allow the user to:

- Edit their understanding
    
- View selected text
    
- View source file
    
- View agent review
    
- Request agent review
    
- Create memory cell
    
- Delete annotation
    
- Open source location
    

### 10.5 Annotation Dashboard

The dashboard must support:

- Search
    
- Filter by document
    
- Filter by status
    
- Filter by concept
    
- Filter by review state
    
- Filter by creation time
    
- Click-to-open source location
    

---

## 11. Local REST API

### 11.1 API Base

Default local address:

```text
http://127.0.0.1:37891
```

The address should be configurable.

### 11.2 Health Check

```http
GET /api/health
```

Response:

```json
{
  "ok": true,
  "version": "0.1.0",
  "api": true,
  "mcp": true,
  "vault": "Example Vault"
}
```

### 11.3 List Annotations

```http
GET /api/annotations
```

Query parameters:

```text
query
file
status
correctness
concept
tag
limit
offset
```

### 11.4 Get Annotation Detail

```http
GET /api/annotations/:id
```

### 11.5 Create Annotation

```http
POST /api/annotations
```

### 11.6 Update Annotation

```http
PATCH /api/annotations/:id
```

### 11.7 Delete Annotation

```http
DELETE /api/annotations/:id
```

### 11.8 Write Agent Review

```http
POST /api/annotations/:id/review
```

Request:

```json
{
  "source": "opencode",
  "review": {
    "correctness": "partially_correct",
    "score": 0.72,
    "summary": "理解方向正确，但缺少 Q/K/V 投影子空间解释。",
    "strengths": ["抓住了多视角直觉"],
    "weaknesses": ["未解释不同 head 的不同投影"],
    "suggestedRevision": "更准确地说，多头注意力通过不同 Q/K/V 投影...",
    "socraticQuestion": "为什么不同 head 需要不同的 Wq/Wk/Wv？"
  }
}
```

### 11.9 List Memory Cells

```http
GET /api/memory-cells
```

### 11.10 Create Memory Cell

```http
POST /api/memory-cells
```

### 11.11 Get Recent Learning Context

```http
GET /api/learning-context
```

### 11.12 Export Markdown

```http
GET /api/export/markdown
```

---

## 12. MCP Server

### 12.1 Purpose

The MCP server is the main interface for agents.

Agents should use MCP tools instead of reading internal plugin files directly whenever possible.

### 12.2 Required Tools

#### Tool: `list_recent_annotations`

Input:

```json
{
  "limit": 20,
  "days": 7
}
```

Output:

```json
{
  "annotations": [
    {
      "id": "ann-001",
      "filePath": "Papers/Attention.md",
      "selectedText": "Multi-head attention allows...",
      "userNote": "我理解它是从多个角度看同一句话。",
      "status": "reviewed",
      "correctness": "partially_correct",
      "concepts": ["Multi-head Attention"],
      "openUri": "obsidian://open?vault=Vault&file=Papers/Attention.md"
    }
  ]
}
```

#### Tool: `search_annotations`

Input:

```json
{
  "query": "multi-head attention",
  "filters": {
    "status": "reviewed",
    "correctness": "partially_correct"
  },
  "limit": 10
}
```

#### Tool: `get_annotation_detail`

Input:

```json
{
  "annotationId": "ann-001"
}
```

Output:

```json
{
  "id": "ann-001",
  "filePath": "Papers/Attention.md",
  "selectedText": "Multi-head attention allows...",
  "contextBefore": "...",
  "contextAfter": "...",
  "userNote": "我的理解是...",
  "review": {
    "correctness": "partially_correct",
    "summary": "方向正确，但缺少 Q/K/V 投影解释。"
  },
  "memoryCells": [
    {
      "id": "mem-001",
      "summary": "用户理解了 multi-head attention 的多视角直觉，但对 projection subspace 不稳定。"
    }
  ]
}
```

#### Tool: `get_recent_learning_context`

Input:

```json
{}
```

Output:

```json
{
  "recentlyStudied": [
    "Multi-head Attention",
    "MCP Server",
    "Obsidian Plugin Development"
  ],
  "activeConfusions": [
    "Q/K/V projection",
    "Memory Cell vs vector retrieval"
  ],
  "highValueAnnotations": ["ann-001", "ann-002"],
  "suggestedAgentBehavior": [
    "先要求用户复述理解，再纠错",
    "帮助用户压缩 MVP",
    "引用批注时说明来源文档"
  ]
}
```

#### Tool: `write_agent_review`

Input:

```json
{
  "annotationId": "ann-001",
  "review": {
    "source": "opencode",
    "correctness": "partially_correct",
    "score": 0.72,
    "summary": "理解方向正确，但缺少 Q/K/V 投影解释。",
    "strengths": ["抓住了多视角直觉"],
    "weaknesses": ["未解释不同 head 的不同投影"],
    "suggestedRevision": "多头注意力通过不同 Q/K/V 投影，在多个表示子空间中并行计算注意力，再拼接输出。",
    "socraticQuestion": "如果多个 head 只是重复看同一句话，为什么需要不同的 Wq/Wk/Wv？"
  }
}
```

#### Tool: `create_memory_cell`

Input:

```json
{
  "sourceAnnotationId": "ann-001",
  "memoryCell": {
    "type": "conceptual_understanding",
    "concept": "Multi-head Attention",
    "summary": "用户理解了多视角直觉，但对 Q/K/V 投影子空间机制仍不稳定。",
    "evidence": "来自 Papers/Attention is All You Need.md 的批注 ann-001",
    "agentGuidance": "下次讨论 attention 时，先要求用户解释为什么不同 head 需要不同线性投影。"
  }
}
```

---

## 13. Agent Integration

### 13.1 OpenCode Integration

OpenCode integration is required for MVP.

The project must provide:

```text
annotation-tutor setup opencode
```

This command should:

1. Detect whether OpenCode is installed
    
2. Start or verify the local Annotation Tutor service
    
3. Generate or update OpenCode MCP configuration
    
4. Generate Annotation Tutor Skill
    
5. Test `list_recent_annotations`
    
6. Report success or detailed failure instructions
    

### 13.2 OpenCode Skill

The project should generate:

```text
.opencode/skills/annotation-tutor/SKILL.md
```

Recommended content:

```md
# Annotation Tutor

Use this skill when the user asks about their Obsidian annotations, learning progress, paper reading, textbook notes, or conceptual understanding.

## Workflow

1. Call `get_recent_learning_context`.
2. If the user asks about a concept, call `search_annotations`.
3. If relevant annotations exist, call `get_annotation_detail`.
4. Review the user's understanding against the selected source text.
5. If the user asks for feedback, call `write_agent_review`.
6. If the annotation contains durable learning value, call `create_memory_cell`.

## Review Style

Do not merely summarize the source text.

The user should first be treated as a learner who has already written an interpretation. Your role is to:
- identify what is correct,
- identify what is missing,
- identify what is wrong,
- provide a better version,
- ask one Socratic question.

## Citation Rule

When referring to an annotation, mention:
- annotation id,
- source Markdown file,
- selected text summary.
```

### 13.3 Codex Integration

Codex support should be designed as a plugin pack.

Recommended structure:

```text
codex-annotation-tutor-plugin/
├── plugin.json
├── skills/
│   └── annotation-tutor/SKILL.md
├── mcp/
│   └── annotation-tutor.json
└── AGENTS.md
```

Codex integration may be implemented after MVP if OpenCode support is completed first.

### 13.4 Claude Code Integration

Claude Code support should use an agent-readable instruction file.

Recommended file:

```text
AGENTS.md
```

The file should instruct the agent to:

1. Use MCP tools when available
    
2. Read `Agent Context/recent-learning.md` as fallback
    
3. Search annotations before answering questions about the user's learning
    
4. Write review results only when the user requests or permits it
    
5. Avoid making unsupported claims about the user's ability or personality
    

---

## 14. Direct Model API Optional Module

### 14.1 Status

Direct model API support is optional and must not be required for the main user experience.

### 14.2 Purpose

This module exists for:

- Developers
    
- Advanced users
    
- Users building Android/iOS/Web clients
    
- Users who prefer direct API calls
    
- Offline/local model setups
    

### 14.3 Supported Providers

The system may support:

- OpenAI-compatible API
    
- DeepSeek
    
- Qwen
    
- OpenRouter
    
- Ollama
    
- LM Studio
    

### 14.4 UI Placement

Direct model API must be placed under:

```text
Advanced Settings → Direct Model API
```

It must not appear in the beginner onboarding path.

---

## 15. Learning Reflection Optional Module

### 15.1 Default State

Learning reflection must be disabled by default.

### 15.2 Modes

The system should support three modes:

```text
Off
Gentle Summary
Full Reflection
```

Default recommended mode:

```text
Off
```

The first opt-in suggestion may recommend:

```text
Gentle Summary
```

### 15.3 Gentle Summary

This mode generates non-scoring Markdown summaries.

Example path:

```text
Learning Profile/weekly-reports/2026-W23.md
```

Example:

```md
# Weekly Learning Reflection

## 你这周关注的问题

- 为什么多头注意力需要多个 head
- Memory Cell 和普通笔记有什么区别
- Obsidian 插件如何暴露给 Agent

## 值得保留的理解

你已经能把“批注”理解为 Agent 可引用的学习上下文，而不只是普通评论。

## 可以继续澄清的问题

- MCP 和 REST API 的职责边界
- Agent 写回批注时的权限控制
- Memory Cell 的最小字段
```

### 15.4 Full Reflection

This mode may include:

- Concept mastery
    
- Review schedule
    
- Confusion patterns
    
- Progress summary
    

It must avoid harmful labels.

Allowed:

```text
用户最近对 Q/K/V 的理解仍不稳定。
```

Disallowed:

```text
用户学习能力差。
```

---

## 16. Beginner Onboarding

### 16.1 First-run Wizard

The first-run wizard must show:

```text
欢迎使用 Annotation Tutor

这个插件可以帮助你：
1. 在文档中划线和写理解
2. 让 Agent 批改你的理解
3. 保存你的学习记忆
4. 在以后复习和对话时引用这些批注

请选择你的使用方式：
```

Buttons:

```text
[只使用批注功能]
[连接 OpenCode，免费/低成本使用 Agent]
[我是开发者，我想使用 API]
```

### 16.2 Annotation Guidance

When creating the first annotation, show:

```text
你正在创建一条学习批注。

建议你不要直接让 AI 总结这段话。
请先用自己的话写下你对这段话的理解。

例如：
“我理解这段话的意思是……”
“我不确定这里的 xxx 是不是指……”
“这和我之前学过的 xxx 很像，但区别可能是……”
```

Buttons:

```text
[保存我的理解]
[让 Agent 稍后批改]
[只保存，不批改]
```

### 16.3 Agent Permission Explanation

Before enabling agent access, show:

```text
Agent 可以读取你的批注，但不会自动读取你的所有文件。

默认情况下，Agent 只能通过 Annotation Tutor 提供的工具访问：
- 你创建的批注
- 批注所在的文档路径
- 被批注的文本片段
- 你自己写下的理解
- 你允许保存的 Memory Cell

你可以随时关闭 Agent 访问。
```

---

## 17. CLI Design

The project should provide a CLI named:

```text
annotation-tutor
```

### 17.1 Commands

```bash
annotation-tutor doctor
annotation-tutor setup opencode
annotation-tutor setup codex
annotation-tutor setup claude-code
annotation-tutor start
annotation-tutor stop
annotation-tutor status
annotation-tutor export
annotation-tutor rebuild-index
```

### 17.2 Doctor Command

```bash
annotation-tutor doctor
```

Example output:

```text
✓ Obsidian vault found
✓ Annotation Tutor plugin installed
✓ Local API server available
✓ MCP server available
✓ OpenCode found
✗ Codex not found
✓ Agent Context Markdown generated
```

### 17.3 Setup OpenCode

```bash
annotation-tutor setup opencode
```

Should:

- Locate OpenCode config path
    
- Write MCP server config
    
- Generate Skill file
    
- Test MCP connection
    
- Print next-step instructions
    

### 17.4 Rebuild Index

```bash
annotation-tutor rebuild-index
```

Should rebuild SQLite index from sidecar JSON and source Markdown anchors.

---

## 18. Security and Privacy

### 18.1 Default Privacy

The default mode must be local-only.

### 18.2 Agent Permissions

Agent write-back must require explicit permission.

Permission levels:

```text
Read annotations only
Read annotations and memory cells
Write review results
Create memory cells
Update learning context
```

### 18.3 Delete and Export

The user must be able to:

- Delete one annotation
    
- Delete all annotations
    
- Delete all reviews
    
- Delete all memory cells
    
- Delete learning reflection files
    
- Export all data
    
- Rebuild SQLite index
    

### 18.4 API Security

Local API should bind to:

```text
127.0.0.1
```

by default.

If exposed beyond localhost, the system must require explicit configuration.

---

## 19. Repository Structure

Recommended repository structure:

```text
annotation-tutor/
├── README.md
├── package.json
├── manifest.json
├── docs/
│   ├── design-spec.md
│   ├── getting-started/
│   │   ├── 01-install-for-students.md
│   │   ├── 02-create-your-first-annotation.md
│   │   ├── 03-connect-opencode.md
│   │   ├── 04-ask-agent-to-review.md
│   │   └── 05-understand-memory-cells.md
│   ├── concepts/
│   │   ├── what-is-an-annotation.md
│   │   ├── what-is-a-memory-cell.md
│   │   ├── what-is-agent-context.md
│   │   └── why-no-api-key-required.md
│   ├── developers/
│   │   ├── api-reference.md
│   │   ├── mcp-tools.md
│   │   ├── android-ios-integration.md
│   │   ├── sdk.md
│   │   └── plugin-architecture.md
│   ├── privacy/
│   │   ├── local-first.md
│   │   ├── what-data-is-stored.md
│   │   └── how-to-delete-data.md
│   └── troubleshooting/
│       ├── opencode-not-found.md
│       ├── mcp-not-working.md
│       ├── annotation-jump-failed.md
│       └── api-server-failed.md
│
├── src/
│   ├── main.ts
│   ├── settings/
│   │   └── SettingsTab.ts
│   ├── annotation/
│   │   ├── AnnotationSchema.ts
│   │   ├── AnnotationStore.ts
│   │   ├── AnnotationIndexer.ts
│   │   └── AnchorResolver.ts
│   ├── editor/
│   │   ├── decorations.ts
│   │   ├── commands.ts
│   │   └── contextMenu.ts
│   ├── dashboard/
│   │   ├── AnnotationDashboard.ts
│   │   └── filters.ts
│   ├── memory/
│   │   ├── MemoryCellSchema.ts
│   │   ├── MemoryCellStore.ts
│   │   └── AgentContextExporter.ts
│   ├── service/
│   │   ├── apiServer.ts
│   │   ├── routes.ts
│   │   └── health.ts
│   ├── mcp/
│   │   ├── server.ts
│   │   └── tools/
│   │       ├── listRecentAnnotations.ts
│   │       ├── searchAnnotations.ts
│   │       ├── getAnnotationDetail.ts
│   │       ├── getRecentLearningContext.ts
│   │       ├── writeAgentReview.ts
│   │       └── createMemoryCell.ts
│   ├── agent/
│   │   ├── opencodeSetup.ts
│   │   ├── codexSetup.ts
│   │   ├── claudeCodeSetup.ts
│   │   └── skillTemplates.ts
│   ├── cli/
│   │   └── index.ts
│   └── optional/
│       ├── direct-model-api/
│       ├── learning-reflection/
│       └── skins/
│
├── templates/
│   ├── recent-learning.md
│   ├── learner-profile.md
│   ├── opencode-skill.md
│   ├── AGENTS.md
│   └── codex-plugin/
│
└── examples/
    ├── sample-vault/
    ├── opencode-config.json
    └── mcp-example.json
```

---

## 20. Development Phases

### Phase 0: Project Skeleton

Deliverables:

- Obsidian plugin scaffold
    
- Settings tab
    
- Basic data schemas
    
- Local storage paths
    
- README
    

### Phase 1: Annotation Core

Deliverables:

- Create annotation from selected text
    
- Save sidecar JSON
    
- Add Markdown anchor
    
- Render annotation mark
    
- Edit annotation in side panel
    

### Phase 2: Annotation Dashboard

Deliverables:

- Global annotation dashboard
    
- SQLite index
    
- Search/filter
    
- Click-to-open source document
    
- Anchor resolution
    

### Phase 3: Local API

Deliverables:

- Local REST API
    
- Health check
    
- Annotation CRUD
    
- Review write endpoint
    
- Memory cell endpoint
    
- OpenAPI schema
    

### Phase 4: MCP Server

Deliverables:

- MCP server
    
- Required tools
    
- Agent read tools
    
- Agent write-back tools
    

### Phase 5: OpenCode Integration

Deliverables:

- `annotation-tutor setup opencode`
    
- OpenCode skill generation
    
- MCP config generation
    
- Doctor command
    
- Beginner-friendly setup UI
    

### Phase 6: Optional Modules

Deliverables:

- Codex plugin pack
    
- Claude Code AGENTS.md
    
- Direct model API fallback
    
- Gentle learning reflection
    
- Spaced review
    
- Mascot skin system
    

---

## 21. Acceptance Criteria for MVP

The MVP is complete when all of the following are true:

1. A user can select text in an Obsidian Markdown file and create an annotation.
    
2. The annotation is saved locally.
    
3. The annotation is visually visible in the editor.
    
4. The user can open a global dashboard and see all annotations.
    
5. The user can click an annotation and return to the source Markdown location.
    
6. A local REST API can list and retrieve annotations.
    
7. A local MCP server can expose annotations to an agent.
    
8. OpenCode can be configured using a beginner-friendly setup flow.
    
9. OpenCode can search annotations through MCP.
    
10. OpenCode can read annotation details through MCP.
    
11. OpenCode can write an agent review back to an annotation.
    
12. The system can generate `Agent Context/recent-learning.md`.
    
13. The user is not required to configure any model API key.
    
14. Learning reflection is optional and disabled by default.
    
15. The user can delete annotations and generated reviews.
    

---

## 22. Implementation Notes for Coding Agents

### 22.1 Do Not Overbuild

Do not implement vector search, cloud sync, mobile app, skin marketplace, or complex learning analytics in the MVP.

### 22.2 Prefer Simple Local Files

Prefer JSON, Markdown, YAML, and SQLite before introducing heavier infrastructure.

### 22.3 Keep Agent and API Logic Shared

MCP tools and REST API endpoints should call the same core services.

Do not duplicate business logic.

### 22.4 Keep Direct Model API Optional

Do not place model API settings in the default onboarding flow.

### 22.5 Make Errors Human-readable

Every setup failure should explain:

- What failed
    
- Why it matters
    
- What the user can do next
    

### 22.6 Optimize for Students

Avoid intimidating terminology in user-facing text.

Prefer:

```text
Connect with OpenCode
```

over:

```text
Configure MCP Server
```

Prefer:

```text
Learning Reflection
```

over:

```text
Learning Assessment
```

Prefer:

```text
Let Agent Review My Understanding
```

over:

```text
Run LLM Evaluation
```

---

## 23. Final Product Positioning

Annotation Tutor is not just an Obsidian AI plugin.

It is a local-first learning annotation infrastructure that turns a learner's annotations, interpretations, agent reviews, and memory cells into a context layer usable by agents and future learning applications.

Product slogan:

```text
Turn your annotations into agent-readable learning memory.
```

Chinese slogan:

```text
让你的批注成为 Agent 能理解的学习记忆。
```
