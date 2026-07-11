/**
 * THE volatile bit, isolated. When the OpenAI codex backend drifts, you edit
 * ONLY this file (plus config.ts) and the smoke-test fixture.
 *
 * Codex request envelope (aligned with pi-ai's dedicated Codex provider; the
 * original minimal form was captured from a proven-200 spike, secrets masked):
 *
 *   POST https://chatgpt.com/backend-api/codex/responses
 *   Authorization: Bearer at-***
 *   chatgpt-account-id: ***UUID***
 *   OpenAI-Beta: responses=experimental
 *   originator: pi
 *   Content-Type: application/json
 *   Accept: text/event-stream
 *
 *   { "model":"gpt-5.5", "input":[{user…}], "stream":true, "store":false,
 *     "reasoning":{"effort":…}, "instructions":"…",
 *     "text":{"verbosity":"low"}, "include":["reasoning.encrypted_content"],
 *     "tool_choice":"auto", "parallel_tool_calls":true }
 *
 * The body-delta vs what pi's generic openai-responses provider emits: codex
 * requires a TOP-LEVEL `instructions` string and accepts a narrower parameter/tool
 * shape than the public Responses API. `convertResponsesMessages` instead inlines
 * the system prompt as a `developer` turn inside `input`, while the generic builder
 * can add public-API-only fields and emits `strict:false` tools. `makeOnPayload`
 * reproduces pi's dedicated Codex request shape post-hoc.
 */

import { DEFAULT_INSTRUCTIONS, OPENAI_BETA, ORIGINATOR } from "./config.js";

/**
 * Body transform for the `onPayload` hook. `onPayload` only receives
 * `(payload, model)` — not `context` — so the system prompt is captured here in a
 * closure. Carried verbatim from the proven spike.
 */
export function makeOnPayload(systemPrompt: string | undefined) {
  return (payload: unknown): unknown => {
    const body = payload as Record<string, unknown> & {
      input?: unknown[];
      tools?: unknown[];
    };
    // 1. Hoist the system prompt to a top-level `instructions` (codex gate).
    body.instructions =
      systemPrompt && systemPrompt.length > 0 ? systemPrompt : DEFAULT_INSTRUCTIONS;
    // 2. Drop the leading developer/system turn convertResponsesMessages injected
    //    (it would otherwise duplicate the instructions inside `input`).
    if (Array.isArray(body.input)) {
      body.input = body.input.filter((m) => {
        const role = (m as { role?: string })?.role;
        return role !== "system" && role !== "developer";
      });
    }
    // 3. Enforce codex gates (buildParams already sets these; belt-and-suspenders).
    body.store = false;
    body.stream = true;

    // 4. Match pi-ai's dedicated Codex request defaults. The Codex endpoint has a
    //    stricter allowlist than api.openai.com and does not safely inherit every
    //    default chosen by the generic Responses builder.
    body.text ??= { verbosity: "low" };
    body.include = ["reasoning.encrypted_content"];
    body.tool_choice = "auto";
    body.parallel_tool_calls = true;

    // Codex expects function tools without the public API's `strict:false` marker;
    // pi-ai's dedicated Codex provider deliberately sends `strict:null` instead.
    if (Array.isArray(body.tools)) {
      body.tools = body.tools.map((tool) => {
        if (!tool || typeof tool !== "object") return tool;
        const normalized = { ...(tool as Record<string, unknown>) };
        if (normalized.type === "function") normalized.strict = null;
        return normalized;
      });
    }

    // These public Responses parameters are not part of pi-ai's Codex body and
    // have been rejected by the subscription backend as unsupported.
    delete body.max_output_tokens;
    delete body.prompt_cache_retention;
    return body;
  };
}

/**
 * The codex wire headers. `streamSimpleOpenAIResponses` merges these as the SDK's
 * `defaultHeaders` without clobbering, so our values win.
 */
export function buildHeaders(
  pat: string,
  accountId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    ...extra,
    Authorization: `Bearer ${pat}`,
    "chatgpt-account-id": accountId,
    "OpenAI-Beta": OPENAI_BETA,
    originator: ORIGINATOR,
  };
}
