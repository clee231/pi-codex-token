import { describe, expect, it } from "vitest";
import { buildHeaders, makeOnPayload } from "../src/codex-envelope.js";
import { DEFAULT_INSTRUCTIONS, OPENAI_BETA, ORIGINATOR } from "../src/config.js";

/** The shape pi's generic openai-responses provider emits (system prompt as a developer turn). */
function recordedPayload() {
  return {
    model: "gpt-5.5",
    input: [
      { role: "developer", content: "You are terse." },
      { role: "user", content: [{ type: "input_text", text: "hi" }] },
    ],
    stream: true,
    store: false,
    reasoning: { effort: "none" },
  };
}

describe("makeOnPayload", () => {
  it("hoists the system prompt to top-level instructions and drops the developer turn", () => {
    const out = makeOnPayload("You are terse.")(recordedPayload()) as Record<string, unknown> & {
      input: { role: string }[];
    };
    expect(out.instructions).toBe("You are terse.");
    expect(out.input.some((m) => m.role === "developer" || m.role === "system")).toBe(false);
    expect(out.input).toHaveLength(1);
    expect(out.store).toBe(false);
    expect(out.stream).toBe(true);
    expect(out.text).toEqual({ verbosity: "low" });
    expect(out.include).toEqual(["reasoning.encrypted_content"]);
    expect(out.tool_choice).toBe("auto");
    expect(out.parallel_tool_calls).toBe(true);
  });

  it("uses the default instructions when systemPrompt is missing or empty", () => {
    expect((makeOnPayload(undefined)(recordedPayload()) as { instructions: string }).instructions).toBe(
      DEFAULT_INSTRUCTIONS,
    );
    expect((makeOnPayload("")(recordedPayload()) as { instructions: string }).instructions).toBe(
      DEFAULT_INSTRUCTIONS,
    );
  });

  it("also strips a leading system turn", () => {
    const payload = { input: [{ role: "system", content: "x" }, { role: "user", content: "y" }] };
    const out = makeOnPayload("sp")(payload) as { input: { role: string }[] };
    expect(out.input).toEqual([{ role: "user", content: "y" }]);
  });

  it("tolerates a non-array input", () => {
    const out = makeOnPayload("sp")({ input: undefined }) as Record<string, unknown>;
    expect(out.instructions).toBe("sp");
    expect(out.store).toBe(false);
  });

  it("normalizes generic Responses tools and strips unsupported public parameters", () => {
    const payload = {
      ...recordedPayload(),
      tools: [
        { type: "function", name: "shell", parameters: {}, strict: false },
        { type: "web_search_preview" },
        null,
      ],
      text: { verbosity: "medium" },
      max_output_tokens: 128000,
      prompt_cache_retention: "24h",
    };

    const out = makeOnPayload("sp")(payload) as Record<string, unknown> & {
      tools: unknown[];
    };
    expect(out.tools).toEqual([
      { type: "function", name: "shell", parameters: {}, strict: null },
      { type: "web_search_preview" },
      null,
    ]);
    expect(out.text).toEqual({ verbosity: "medium" });
    expect(out).not.toHaveProperty("max_output_tokens");
    expect(out).not.toHaveProperty("prompt_cache_retention");
  });

  it("is idempotent", () => {
    const fn = makeOnPayload("sp");
    const once = fn(recordedPayload());
    const twice = fn(once);
    expect(twice).toEqual(once);
  });
});

describe("buildHeaders", () => {
  it("produces the exact codex wire header set", () => {
    expect(buildHeaders("at-tok", "acct-uuid")).toEqual({
      Authorization: "Bearer at-tok",
      "chatgpt-account-id": "acct-uuid",
      "OpenAI-Beta": OPENAI_BETA,
      originator: ORIGINATOR,
    });
  });

  it("merges extra headers but never lets them clobber the codex headers", () => {
    const headers = buildHeaders("at-tok", "acct-uuid", {
      "X-Custom": "1",
      Authorization: "Bearer SHOULD_LOSE",
    });
    expect(headers["X-Custom"]).toBe("1");
    expect(headers.Authorization).toBe("Bearer at-tok");
  });
});
