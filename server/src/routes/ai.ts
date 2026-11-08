import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";

export const aiRouter = Router();

/** Prefer DeepSeek when configured; otherwise Anthropic Claude. */
function aiConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (deepseekKey) {
    return new Anthropic({
      apiKey: deepseekKey,
      // DeepSeek exposes an Anthropic-compatible surface under /anthropic.
      baseURL: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "") + "/anthropic",
    });
  }
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });
}

function modelId(): string {
  if (process.env.DEEPSEEK_API_KEY?.trim()) {
    return process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  }
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-8";
}

const SYSTEM = `You are the AI assistant inside OpenTerminal, a Bloomberg-style financial terminal.
You help the user interpret market data, charts, news, options chains and macro indicators.
Answer concisely and professionally, in the language the user writes in.
When market data is provided in the conversation as JSON context, ground your answer in it.
You are not a licensed financial advisor: never give personalized investment advice or tell the user what to buy or sell.`;

aiRouter.post("/chat", async (req, res) => {
  const { messages, context } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }
  if (!aiConfigured()) {
    return res.status(503).json({
      error: "AI assistant unavailable: set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY on the server.",
    });
  }
  try {
    const contextBlock = context
      ? [{ role: "user" as const, content: `Current terminal context (JSON):\n${JSON.stringify(context)}` }]
      : [];
    const usingDeepseek = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
    const response = await getClient().messages.create({
      model: modelId(),
      max_tokens: 16000,
      // Claude extended thinking is not available on DeepSeek.
      ...(usingDeepseek ? {} : { thinking: { type: "adaptive" as const } }),
      system: SYSTEM,
      messages: [...contextBlock, ...messages],
    });
    if (response.stop_reason === "refusal") {
      return res.json({ text: "The assistant declined to answer this request." });
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("");
    res.json({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("api_key") || msg.includes("authentication")) {
      return res.status(503).json({
        error: "AI assistant unavailable: set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY on the server.",
      });
    }
    res.status(502).json({ error: msg });
  }
});
