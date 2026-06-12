import readline from "node:readline";

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

let nextThread = 1;
let nextTurn = 1;
const pendingTurns = new Map();

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    write({
      id: message.id,
      result: {
        userAgent: "fake-codex",
        codexHome: "D:/fake",
        platformFamily: "windows",
        platformOs: "windows"
      }
    });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "thread/start") {
    write({
      id: message.id,
      result: { thread: { id: `thread-${nextThread++}` } }
    });
    return;
  }
  if (message.method === "turn/start") {
    const turnId = `turn-${nextTurn++}`;
    const threadId = message.params.threadId;
    const prompt = message.params.input[0].text;
    write({ id: message.id, result: { turn: { id: turnId } } });
    pendingTurns.set(turnId, { threadId });
    if (prompt.includes("ann-cancel")) return;
    const text = prompt.includes("follow-up")
      ? JSON.stringify({ answer: "Fake follow-up answer." })
      : JSON.stringify({
          correctness: "correct",
          summary: "Fake structured review.",
          strengths: ["Scoped to the annotation."],
          weaknesses: [],
          missingConcepts: [],
          suggestedRevision: "Keep the explanation.",
          socraticQuestion: "What evidence supports it?"
        });
    queueMicrotask(() => {
      write({
        method: "item/completed",
        params: {
          threadId,
          turnId,
          item: { type: "agentMessage", text }
        }
      });
      write({
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            id: turnId,
            status: "completed",
            error: null,
            items: [{ type: "agentMessage", text }]
          }
        }
      });
    });
    return;
  }
  if (message.method === "turn/interrupt") {
    const pending = pendingTurns.get(message.params.turnId);
    write({
      id: message.id,
      result: {}
    });
    if (pending) {
      write({
        method: "turn/completed",
        params: {
          threadId: pending.threadId,
          turn: {
            id: message.params.turnId,
            status: "interrupted",
            error: null,
            items: []
          }
        }
      });
    }
  }
});
