/**
 * OpenRouter adapter execute() — thin proxy to openrouter-cli.
 *
 * Responsibilities:
 *   - Build prompt from Paperclip wake context + skills
 *   - Spawn openrouter-cli with the prompt
 *   - Map CLI's stream-json events to Paperclip TranscriptEntry
 *   - Manage issue state (in_progress at start, done/blocked at end)
 *   - Post the final assistant output as an issue comment
 */

import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  UsageSummary,
} from "@paperclipai/adapter-utils";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import {
  renderPaperclipWakePrompt,
} from "@paperclipai/adapter-utils/server-utils";

import {
  OPENROUTER_GENERATION_ENDPOINT,
  type OpenRouterConfig,
} from "../index.js";
import { PaperclipApi, PaperclipApiError } from "./paperclip-api.js";
import { loadSkills, renderSkillsForPrompt } from "./skills.js";
import {
  emitInit,
  emitAssistant,
  emitToolCall,
  emitToolResult,
  emitResult,
  emitSystem,
  writeRawStderr,
  type OnLog,
} from "./transcript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../../cli/dist/index.js");

export async function execute(
  ctx: AdapterExecutionContext
): Promise<AdapterExecutionResult> {
  const { runId, config: rawConfig, context, onLog, authToken } = ctx;
  const config = rawConfig as unknown as OpenRouterConfig;

  const openRouterApiKey =
    typeof config.apiKey === "string" && config.apiKey.trim().length > 0
      ? config.apiKey.trim()
      : typeof process.env.OPENROUTER_API_KEY === "string" &&
          process.env.OPENROUTER_API_KEY.trim().length > 0
        ? process.env.OPENROUTER_API_KEY.trim()
        : "";

  const issueId =
    typeof context.taskId === "string" && context.taskId.trim().length > 0
      ? context.taskId.trim()
      : typeof context.issueId === "string" && context.issueId.trim().length > 0
        ? context.issueId.trim()
        : null;

  const api = authToken ? new PaperclipApi({ ...ctx, authToken }) : null;

  const debug = (message: string) => {
    if (process.env.OPENROUTER_ADAPTER_DEBUG !== "1") return;

    void fs.appendFile(
      "/tmp/paperclip-openrouter-debug.log",
      `[${new Date().toISOString()}] ${message}
`,
    ).catch(() => undefined);
  };

  debug(`runId=${runId} cwd=${process.cwd()} cliPath=${CLI_PATH}`);
  debug(`config.model=${JSON.stringify(config.model)} apiKeyPresent=${Boolean(openRouterApiKey)} apiKeyLen=${openRouterApiKey.length}`);
  debug(`contextKeys=${Object.keys(context as any).join(",")}`);
  debug(`paperclipWakeType=${typeof (context as any).paperclipWake}`);
  debug(`paperclipWakeKeys=${
    (context as any).paperclipWake && typeof (context as any).paperclipWake === "object"
      ? Object.keys((context as any).paperclipWake).join(",")
      : ""
  }`);
  debug(`contextPreview=${JSON.stringify(context).slice(0, 3000)}`);

  if (!openRouterApiKey) {
    emitSystem(onLog, "OpenRouter API key missing: set config.apiKey or OPENROUTER_API_KEY.");
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "OpenRouter API key missing",
    };
  }

  // ----------------------------------------------------------------------
  // 1. Build the prompt
  // ----------------------------------------------------------------------
  let prompt = "";
  try {
    const paperclipWake = renderPaperclipWakePrompt((context as any).paperclipWake, {
      resumedSession: false,
    });

    const taskMarkdown =
      typeof (context as any).paperclipTaskMarkdown === "string"
        ? (context as any).paperclipTaskMarkdown.trim()
        : "";

    const fallbackPrompt = [
      "You are running as a Paperclip agent through the OpenRouter adapter.",
      "",
      "Complete the current task now. Do not merely describe the next action.",
      "If the task asks for exact output, return that exact output and nothing else.",
      "",
      "Runtime context JSON:",
      "```json",
      JSON.stringify(context, null, 2),
      "```",
    ].join("\n");

    prompt = [
      "You are executing a Paperclip task.",
      "Complete the task now in this run.",
      "Do not say what you will do next; produce the requested result.",
      "",
      taskMarkdown ? "## Current Task\n" + taskMarkdown : "",
      paperclipWake && paperclipWake.trim().length > 0
        ? "## Wake Metadata\nUse this only as supporting context. The Current Task above is authoritative.\n\n" + paperclipWake
        : "",
      !taskMarkdown && (!paperclipWake || paperclipWake.trim().length === 0)
        ? fallbackPrompt
        : "",
    ].filter(Boolean).join("\n\n");
  } catch (err) {
    emitSystem(onLog, `Error building prompt: ${err}`);
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: `Failed to build prompt: ${err}`,
    };
  }

  const requestedModel =
    typeof config.model === "string" ? config.model.trim() : "";
  const selectedModel =
    !requestedModel ||
    requestedModel === "anthropic/claude-3.5-sonnet" ||
    requestedModel.toLowerCase() === "default"
      ? "openrouter/auto"
      : requestedModel;

  emitSystem(onLog, `OpenRouter selected model: ${selectedModel}`);
  debug(`selectedModel=${selectedModel} promptLength=${prompt.length}`);

  emitInit(onLog, {
    model: selectedModel,
    sessionId: runId,
  });

  // ----------------------------------------------------------------------
  // 3. Spawn openrouter-cli
  // ----------------------------------------------------------------------
  const cliArgs = [
    CLI_PATH,
    "--print",
    "--output-format", "stream-json",
    "--model", selectedModel,
    "--max-tokens", String(config.maxTokens || 4096),
  ];

  const env = {
    ...process.env,
    OPENROUTER_API_KEY: openRouterApiKey,
  };

  debug(`spawn node ${cliArgs.map((a) => JSON.stringify(a)).join(" ")}`);

  const child = spawn("node", cliArgs, {
    cwd: typeof rawConfig.cwd === "string" && rawConfig.cwd.trim().length > 0 ? rawConfig.cwd : process.cwd(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Write prompt to stdin
  child.stdin.write(prompt);
  child.stdin.end();

  let finalAssistantContent = "";
  const cliErrorMessages: string[] = [];
  const usage: UsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
  };

  // ----------------------------------------------------------------------
  // 4. Process stream-json events from CLI
  // ----------------------------------------------------------------------
  const stdoutPromise = new Promise<void>((resolve, reject) => {
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        debug(`stdout=${line.slice(0, 1000)}`);
        try {
          const event = JSON.parse(line);
          switch (event.type) {
            case "assistant":
              finalAssistantContent += event.content;
              emitAssistant(onLog, event.content);
              break;
            case "tool_use":
              emitToolCall(onLog, {
                toolUseId: event.id,
                name: event.name,
                input: event.input,
              });
              break;
            case "tool_result":
              emitToolResult(onLog, {
                toolUseId: event.id,
                content: event.content,
                isError: event.is_error,
              });
              break;
            case "error":
              cliErrorMessages.push(String(event.message || "Unknown CLI error"));
              emitSystem(onLog, `CLI error: ${event.message}`);
              break;
            case "done":
              // All good
              break;
            default:
              // Unknown event, ignore
              break;
          }
        } catch {
          // Not JSON, treat as raw stdout (shouldn't happen with stream-json)
          emitSystem(onLog, `CLI stdout: ${line}`);
        }
      }
    });

    child.stdout.on("end", resolve);
    child.stdout.on("error", reject);
  });

  let stderrText = "";
  const stderrPromise = new Promise<void>((resolve, reject) => {
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrText += text;
      debug(`stderr=${text.slice(0, 1000)}`);
      writeRawStderr(onLog, text);
    });
    child.stderr.on("end", resolve);
    child.stderr.on("error", reject);
  });

  let exitCode = await new Promise<number>((resolve) => {
    child.on("close", resolve);
  });
  debug(`exitCode=${exitCode}`);

  await Promise.all([stdoutPromise, stderrPromise]);

  if (exitCode === 0 && finalAssistantContent.trim().length === 0) {
    const emptyOutputMessage = [
      "openrouter-cli exited successfully but produced no assistant output.",
      cliErrorMessages.length > 0 ? `CLI errors: ${cliErrorMessages.join("; ")}` : "",
      stderrText.trim().length > 0 ? `stderr: ${stderrText.trim()}` : "",
      "The selected OpenRouter model may be invalid, unavailable, rate-limited, or incompatible with the current CLI response parser.",
    ].filter(Boolean).join(" ");

    stderrText += `${stderrText.endsWith("\n") || stderrText.length === 0 ? "" : "\n"}${emptyOutputMessage}\n`;
    emitSystem(onLog, emptyOutputMessage);
    debug(`emptyOutputGuard=${emptyOutputMessage}`);
    exitCode = 1;
  }

  // ----------------------------------------------------------------------
  // 5. Fetch usage from OpenRouter generation endpoint
  // ----------------------------------------------------------------------
  try {
    // The CLI doesn't report usage, so we query the generation endpoint
    // This is best-effort; if it fails we still have a successful run.
    const genRes = await fetch(OPENROUTER_GENERATION_ENDPOINT, {
      headers: { Authorization: `Bearer ${openRouterApiKey}` },
    });
    if (genRes.ok) {
      const genData = await genRes.json() as any;
      // Find the most recent generation for this model
      const latest = genData.data?.[0];
      if (latest) {
        usage.inputTokens = latest.usage?.prompt_tokens || 0;
        usage.outputTokens = latest.usage?.completion_tokens || 0;
        usage.inputTokens =
          latest.usage?.prompt_tokens ??
          latest.usage?.input_tokens ??
          usage.inputTokens;
        usage.outputTokens =
          latest.usage?.completion_tokens ??
          latest.usage?.output_tokens ??
          usage.outputTokens;
      }
    }
  } catch {
    // Ignore usage fetch errors
  }

  // ----------------------------------------------------------------------
  // 6. Add final comment and update issue state
  // ----------------------------------------------------------------------
  if (finalAssistantContent) {
    if (api && issueId) await api.addIssueComment(issueId, { body: finalAssistantContent });
  } else {
    if (api && issueId) await api.addIssueComment(issueId, { body: "_(No output from agent)_" });
  }

  if (exitCode === 0) {
    if (api && issueId) await api.updateIssue(issueId, { status: "done" });
  } else {
    if (api && issueId) await api.updateIssue(issueId, { status: "blocked" });
    if (api && issueId) await api.addIssueComment(issueId, {
      body:
        `CLI exited with code ${exitCode}\n\n` +
        `Model: ${selectedModel}\n\n` +
        (stderrText.trim()
          ? "stderr:\n```\n" + stderrText.trim().slice(-4000) + "\n```"
          : "stderr: _(empty)_"),
    });
  }

  emitResult(onLog, {
    text: finalAssistantContent.slice(0, 500),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedInputTokens,
  });

  return {
    exitCode,
    signal: null,
    timedOut: false,
    usage,
    provider: "openrouter",
    model: selectedModel,
    errorMessage: exitCode === 0 ? null : `openrouter-cli exited with code ${exitCode}`,
  };
}
