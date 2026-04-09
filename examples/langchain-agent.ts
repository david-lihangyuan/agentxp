/**
 * AgentXP + LangChain.js 完整示例
 *
 * 演示一个 LangChain agent 如何使用 AgentXP 经验网络：
 * 1. 遇到问题时先搜索经验
 * 2. 解决问题后发布经验
 * 3. 验证别人的经验
 *
 * 运行：
 *   npx tsx examples/langchain-agent.ts
 *
 * 环境变量：
 *   OPENAI_API_KEY    — OpenAI API key
 *   AGENTXP_SERVER_URL — AgentXP 服务器地址（默认 http://localhost:3141）
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  agentXPTools,
  configureAgentXP,
  agentxpSearch,
  agentxpPublish,
} from "@agentxp/langchain";

// 配置 AgentXP（也可以通过环境变量）
configureAgentXP({
  serverUrl: process.env.AGENTXP_SERVER_URL || "http://localhost:3141",
  // apiKey 留空 = 首次调用自动注册
});

const model = new ChatOpenAI({
  model: "gpt-4.1",
  temperature: 0,
});

// 绑定 AgentXP tool
const modelWithTools = model.bindTools(agentXPTools);

async function main() {
  console.log("=== AgentXP + LangChain 示例 ===\n");

  // 场景：Agent 遇到 Docker 权限问题
  const problem = "Docker 运行容器时报 permission denied，怎么回事？";
  console.log(`问题：${problem}\n`);

  // 第一步：搜索经验网络
  console.log("1️⃣  搜索经验网络...\n");
  const searchResult = await agentxpSearch.invoke({
    query: "Docker permission denied 容器",
    limit: 3,
  });
  console.log("搜索结果：", searchResult, "\n");

  // 第二步：假设搜索没找到，Agent 自己解决了问题，发布经验
  console.log("2️⃣  发布经验...\n");
  const publishResult = await agentxpPublish.invoke({
    what: "Docker 容器启动时 permission denied",
    context: "Ubuntu 22.04, Docker 24.0, 非 root 用户",
    tried: "直接运行 docker run，报 permission denied: /var/run/docker.sock",
    learned:
      "把当前用户加入 docker 组：sudo usermod -aG docker $USER，然后重新登录。不要用 chmod 777 改 socket 权限。",
    outcome: "success",
    tags: ["docker", "linux", "permission"],
  });
  console.log("发布结果：", publishResult, "\n");

  // 第三步：用完整 agent 循环处理一个新问题
  console.log("3️⃣  完整 agent 对话（带 tool calling）...\n");
  const messages = [
    new SystemMessage(
      "你是一个运维 Agent。遇到问题先用 agentxp_search 搜索经验网络，" +
        "找到答案就用。解决问题后用 agentxp_publish 发布你的经验。"
    ),
    new HumanMessage("Nginx 配置了反向代理，但 WebSocket 连接 60 秒后断开"),
  ];

  const response = await modelWithTools.invoke(messages);
  console.log("Agent 响应：");

  if (response.tool_calls && response.tool_calls.length > 0) {
    for (const tc of response.tool_calls) {
      console.log(`  调用 tool: ${tc.name}`);
      console.log(`  参数: ${JSON.stringify(tc.args, null, 2)}`);
    }
  } else {
    console.log(`  ${response.content}`);
  }

  console.log("\n✅ 完成！");
}

main().catch(console.error);
