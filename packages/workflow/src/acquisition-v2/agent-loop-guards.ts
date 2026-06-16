import type { StopCondition, ToolSet } from "ai";
import { shouldStopForRepetition, type ToolStepSignature } from "./repetition-stop.js";

/**
 * Harness guards for the agent loop. The old `stepCountIs(40)` hard-kill was the
 * wrong primitive (killed legit long tasks like the 6-season 一人之下, missed tight
 * loops). We replace it with: a higher step ceiling (60), a cheap OpenHands-style
 * repetition stop, and a calm reflection nudge in the last 10 steps that tells the
 * agent to wrap up + clean staging rather than leave a half-done mess.
 * See the 2026-06-16 design spec.
 */

/** Raised from 40 — a multi-season show needs the headroom; cost/runaway is bounded by this + the repetition stop. */
export const DEFAULT_MAX_STEPS = 60;

/** How many steps before the cap the reflection reminder kicks in. */
export const REMIND_WITHIN_STEPS = 10;

/** Calm wrap-up nudge (R3: must NOT scare the agent into dropping still-gettable episodes). */
export const STEP_50_REMINDER =
  "【进度提醒】本次任务已接近步数预算(约剩 10 步)。这是正常的收尾信号,不是失败。请:" +
  "① 不要再发起新的 searchResources / transferCandidate;" +
  "② 把已转存好的用 moveToSeason 归位、对确实落盘的 markObtained;" +
  "③ discardStaging 清理本次 staging;④ finish。" +
  "这次没来得及拿的集不要紧——只要没被 markObtained,下次每日巡检会自动发现并补齐。" +
  "请稳妥收尾,绝不要为赶进度草率丢弃还能拿到的资源。";

// Minimal structural view of an AI-SDK StepResult — only the fields we read.
interface StepLike {
  toolCalls?: ReadonlyArray<{ toolName: string; input: unknown }>;
  toolResults?: ReadonlyArray<{ output: unknown }>;
}

/** Normalize one loop step into a comparable signature (ids/timestamps excluded — input+output only). */
export function toStepSignature(step: StepLike): ToolStepSignature {
  const calls = step.toolCalls ?? [];
  const results = step.toolResults ?? [];
  return {
    tool: calls.map((c) => c.toolName).join("+"),
    args: JSON.stringify(calls.map((c) => c.input)),
    result: JSON.stringify(results.map((r) => r.output)),
  };
}

/** A StopCondition (for `generateText({ stopWhen })`) that fires on repetition/ping-pong. */
export function buildRepetitionStop<TOOLS extends ToolSet = ToolSet>(): StopCondition<TOOLS> {
  return ({ steps }) => shouldStopForRepetition((steps as ReadonlyArray<StepLike>).map(toStepSignature));
}

/**
 * The reflection nudge, as a pure decision: within the last REMIND_WITHIN_STEPS
 * steps before the cap, return the base system text + reminder (to override the
 * step's system message); otherwise undefined (no override). Pure → unit-testable.
 */
export function reflectionSystemOverride(input: {
  stepNumber: number;
  maxSteps: number;
  baseSystem: string;
  remindWithinSteps?: number;
}): string | undefined {
  const within = input.remindWithinSteps ?? REMIND_WITHIN_STEPS;
  if (input.stepNumber >= input.maxSteps - within) {
    return `${input.baseSystem}\n\n${STEP_50_REMINDER}`;
  }
  return undefined;
}
