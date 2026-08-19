/**
 * The reasoning layer, and the seam that keeps it honest.
 *
 * Every agent in this system asks a brain to make a judgement: which facts a
 * chart note contains, which of three benefit changes to recommend, whether a
 * pattern of fills reads as shopping or as a family filling at one pharmacy.
 * Those are judgements, and a language model is good at them.
 *
 * None of them is a calculation. No brain in this file is ever asked what a
 * claim costs, what a rebate is worth, or whether a criterion is met. Those
 * come back from tools that read the book, and the invariant suite checks that
 * the numbers an agent reports match the numbers the tools returned.
 *
 * The brain is pluggable for a practical reason. The deployed demo has no API
 * key, and an agent surface that goes blank without a network call is not a
 * demonstration of anything. So each agent supplies a scripted planner that
 * produces the same shape as the model would, and every step records which one
 * actually ran. Nothing in the UI pretends a scripted step was a model step.
 */

import { z } from "zod";

export type BrainKind = "model" | "deterministic";

export interface BrainUsage {
  inputTokens: number;
  outputTokens: number;
  costMillicents: number;
}

export interface Thought<T> {
  value: T;
  brain: BrainKind;
  model: string | null;
  usage: BrainUsage;
  elapsedMs: number;
}

const NO_USAGE: BrainUsage = {
  inputTokens: 0,
  outputTokens: 0,
  costMillicents: 0,
};

/**
 * Sonnet list price, in millicents per token, at the time of writing. The
 * operations page reports what the runs cost; a number that is roughly right
 * and openly sourced is more useful than no number.
 */
const RATE_IN = 0.3;
const RATE_OUT = 1.5;
const MODEL = "claude-sonnet-4-5";

export function modelAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function brainLabel(): string {
  return modelAvailable() ? MODEL : "scripted planner";
}

/**
 * Ask for a structured judgement.
 *
 * `fallback` is not an error path. It is the same judgement, reached by rules
 * the agent's author wrote down, and for several of these agents it is what
 * runs in production anyway: extraction from a templated fax does not need a
 * model, and saying otherwise would be the kind of AI-washing this whole
 * project exists to argue against.
 */
export async function judge<T>(opts: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  fallback: () => T | Promise<T>;
}): Promise<Thought<T>> {
  const started = Date.now();

  if (!modelAvailable()) {
    const value = await opts.fallback();
    return {
      value,
      brain: "deterministic",
      model: null,
      usage: NO_USAGE,
      elapsedMs: Date.now() - started,
    };
  }

  try {
    // Imported lazily so the deployed build, which has no key and never takes
    // this path, does not pay to load the provider.
    const { generateObject } = await import("ai");
    const { anthropic } = await import("@ai-sdk/anthropic");
    const res = await generateObject({
      model: anthropic(MODEL),
      system: opts.system,
      prompt: opts.prompt,
      schema: opts.schema as z.ZodType<T> & z.ZodTypeAny,
      temperature: 0,
    });
    const inputTokens = res.usage?.inputTokens ?? 0;
    const outputTokens = res.usage?.outputTokens ?? 0;
    return {
      value: res.object as T,
      brain: "model",
      model: MODEL,
      usage: {
        inputTokens,
        outputTokens,
        costMillicents: Math.round(
          inputTokens * RATE_IN + outputTokens * RATE_OUT,
        ),
      },
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    // A model that is unreachable or returns something off-schema does not get
    // to stop the work. The scripted planner answers and the step says so.
    //
    // Logged, though: with a key configured, every one of these is a run that
    // was meant to be a model run and silently was not, and "brain:
    // deterministic" on the step looks the same whether that was the design or
    // an expired key.
    console.error(
      "[brain] model call failed, falling back to the planner",
      error,
    );
    const value = await opts.fallback();
    return {
      value,
      brain: "deterministic",
      model: null,
      usage: NO_USAGE,
      elapsedMs: Date.now() - started,
    };
  }
}
