import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_STEPS,
  STEP_50_REMINDER,
  buildRepetitionStop,
  reflectionSystemOverride,
  toStepSignature,
} from "../src/index.js";

describe("toStepSignature", () => {
  it("normalizes a step into tool/args/result (ids excluded — uses input+output)", () => {
    const step = {
      toolCalls: [{ toolName: "inspectTargetDir", input: { season: 6 } }],
      toolResults: [{ output: [] }],
    };
    expect(toStepSignature(step)).toEqual({
      tool: "inspectTargetDir",
      args: JSON.stringify([{ season: 6 }]),
      result: JSON.stringify([[]]),
    });
  });

  it("handles a final no-tool step", () => {
    expect(toStepSignature({ toolCalls: [], toolResults: [] })).toEqual({
      tool: "",
      args: "[]",
      result: "[]",
    });
  });
});

describe("buildRepetitionStop", () => {
  it("returns a StopCondition that stops on 4 identical steps", async () => {
    const stop = buildRepetitionStop();
    const same = { toolCalls: [{ toolName: "searchResources", input: { keyword: "x" } }], toolResults: [{ output: "empty" }] };
    expect(await stop({ steps: [same, same, same, same] as never })).toBe(true);
    expect(await stop({ steps: [same, same] as never })).toBe(false);
  });
});

describe("reflectionSystemOverride", () => {
  const base = "BASE SYSTEM";

  it("injects the reminder once within the last N steps before the cap", () => {
    // maxSteps 60, remind within last 10 → from step 50.
    expect(reflectionSystemOverride({ stepNumber: 50, maxSteps: 60, baseSystem: base })).toContain(
      STEP_50_REMINDER,
    );
    expect(reflectionSystemOverride({ stepNumber: 55, maxSteps: 60, baseSystem: base })).toContain(base);
  });

  it("does NOT inject before the threshold", () => {
    expect(reflectionSystemOverride({ stepNumber: 49, maxSteps: 60, baseSystem: base })).toBeUndefined();
    expect(reflectionSystemOverride({ stepNumber: 0, maxSteps: 60, baseSystem: base })).toBeUndefined();
  });

  it("reminder is calm, not scary — frames a normal wrap-up + next-patrol safety net", () => {
    // R3 in the spec: must not panic the agent into dropping still-gettable episodes.
    expect(STEP_50_REMINDER).toContain("巡检"); // remaining caught next patrol
    expect(STEP_50_REMINDER).toContain("discardStaging");
    expect(STEP_50_REMINDER).toMatch(/不是失败|正常|稳/); // reassuring framing
  });
});

describe("DEFAULT_MAX_STEPS", () => {
  it("is 60 (raised from the old 40 that killed 一人之下)", () => {
    expect(DEFAULT_MAX_STEPS).toBe(60);
  });
});
