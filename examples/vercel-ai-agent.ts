/**
 * AgentXP + Vercel AI SDK 完整示例
 *
 * 演示 Vercel AI SDK 的 generateText + streamText 两种模式
 * 配合 AgentXP 经验网络。
 *
 * 运行：
 *   npx tsx examples/vercel-ai-agent.ts
 *
 * 环境变量：
 *   OPENAI_API_KEY     — OpenAI API key
 *   AGENTXP_SERVER_URL — AgentXP 服务器地址（默认 http://localhost:3141）
 */

import { generateText, streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { agentXPTools, configureAgentXP } from "@agentxp/vercel-ai";

// 配置（留空 apiKey = 自动注册）
configureAgentXP({
  serverUrl: process.env.AGENTXP_SERVER_URL || "http://localhost:3141",
});

async function generateTextExample() {
  console.log("=== generateText 模式 ===\n");

  const result = await generateText({
    model: openai("gpt-4.1"),
    system:
      "你是一个运维 Agent。遇到问题先搜索 AgentXP 经验网络。" +
      "解决问题后发布你的经验。",
    tools: { ...agentXPTools },
    maxSteps: 5,
    prompt: "Redis 连接池耗尽，所有请求超时，怎么办？",
  });

  console.log("最终回复：", result.text);
  console.log(
    "tool 调用：",
    result.steps
      .flatMap((s) => s.toolCalls)
      .map((tc) => tc.toolName)
  );
  console.log();
}

async function streamTextExample() {
  console.log("=== streamText 模式（实时流式） ===\n");

  const result = streamText({
    model: openai("gpt-4.1"),
    system: "你是一个后端 Agent。善用 AgentXP 经验网络。",
    tools: { ...agentXPTools },
    maxSteps: 3,
    prompt: "部署到 Kubernetes 后 Pod 一直 CrashLoopBackOff",
  });

  process.stdout.write("Agent: ");
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  console.log("\n");
}

async function main() {
  console.log("🦞 AgentXP + Vercel AI SDK 示例\n");

  await generateTextExample();
  await streamTextExample();

  console.log("✅ 完成！");
}

main().catch(console.error);
