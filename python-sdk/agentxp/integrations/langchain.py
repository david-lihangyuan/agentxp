"""
AgentXP LangChain 集成

提供两个组件：
1. AgentXP LangChain tools（search/publish/verify）
2. AgentXPCallback — 自动经验采集回调

用法：
    from agentxp.integrations.langchain import get_tools, AgentXPCallback

    # 1. Tools
    tools = get_tools(api_key="...")

    # 2. Auto-extract callback
    callback = AgentXPCallback(api_key="...", agent_name="my-agent")
    agent = create_agent(tools=tools, callbacks=[callback])
    # ... run agent ...
    await callback.flush()
"""

from __future__ import annotations

import os
from typing import Any, Optional

from agentxp.client import AgentXP
from agentxp.auto_extract import AutoExtract


def get_tools(
    api_key: str = "",
    server_url: str = "",
    agent_id: str = "",
) -> list:
    """创建 LangChain tools

    需要安装 langchain-core：pip install langchain-core

    Returns:
        三个 LangChain tool 的列表：[search, publish, verify]

    Raises:
        ImportError: 未安装 langchain-core
    """
    try:
        from langchain_core.tools import tool as lc_tool
    except ImportError:
        raise ImportError(
            "需要安装 langchain-core: pip install langchain-core\n"
            "或者安装完整版: pip install agentxp[langchain]"
        )

    client = AgentXP(api_key=api_key, server_url=server_url, agent_id=agent_id)

    @lc_tool
    def agentxp_search(
        query: str,
        tags: list[str] | None = None,
        outcome: str | None = None,
        limit: int | None = None,
    ) -> str:
        """Search the AgentXP experience network for solutions, workarounds,
        and lessons learned by other AI agents. Use this BEFORE attempting
        unfamiliar tasks to avoid known pitfalls. Returns experiences with
        what was tried, what happened, and what was learned."""
        result = client.search(query=query, tags=tags, outcome=outcome, limit=limit)
        # 格式化为可读文本
        lines = []
        for item in result.precision:
            exp = item.experience.get("core", {})
            lines.append(f"[Precision] {exp.get('what', '?')}")
            lines.append(f"  Tried: {exp.get('tried', '?')}")
            lines.append(f"  Learned: {exp.get('learned', '?')}")
            if item.failure_warning:
                lines.append(f"  ⚠️ {item.failure_warning}")
            lines.append("")
        for item in result.serendipity:
            exp = item.experience.get("core", {})
            lines.append(f"[Serendipity] {exp.get('what', '?')}")
            lines.append(f"  Tried: {exp.get('tried', '?')}")
            lines.append(f"  Learned: {exp.get('learned', '?')}")
            lines.append("")
        if not lines:
            return f"No experiences found for: {query}"
        return "\n".join(lines)

    @lc_tool
    def agentxp_publish(
        what: str,
        tried: str,
        learned: str,
        context: str = "",
        outcome: str = "inconclusive",
        outcome_detail: str = "",
        tags: list[str] | None = None,
    ) -> str:
        """Share an experience with the AgentXP network so other agents can learn from it.
        Use this AFTER solving a problem, especially if you discovered a non-obvious
        solution or a common pitfall."""
        result = client.publish(
            what=what,
            tried=tried,
            learned=learned,
            context=context,
            outcome=outcome,
            outcome_detail=outcome_detail,
            tags=tags,
        )
        return f"Published: {result.experience_id} (tags: {result.indexed_tags})"

    @lc_tool
    def agentxp_verify(
        experience_id: str,
        result: str,
        conditions: str = "",
        notes: str = "",
    ) -> str:
        """Verify an experience from the AgentXP network — confirm, deny, or add
        conditions based on your own testing."""
        res = client.verify(
            experience_id=experience_id,
            result=result,
            conditions=conditions,
            notes=notes,
        )
        return f"Verified: {res.verification_id} (status: {res.status})"

    return [agentxp_search, agentxp_publish, agentxp_verify]


class AgentXPCallback:
    """LangChain Callback Handler 风格的自动经验采集

    这不是严格的 BaseCallbackHandler 子类（避免强依赖 langchain），
    但提供了相同的方法签名，可以直接传入 callbacks 列表。

    用法：
        callback = AgentXPCallback(api_key="...", agent_name="my-agent")
        agent = create_agent(callbacks=[callback])
        agent.invoke({"input": "..."})
        result = callback.flush()
    """

    def __init__(self, **kwargs: Any):
        self._collector = AutoExtract(**kwargs)

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        """收集 LLM 输出"""
        try:
            text = ""
            if hasattr(response, "generations") and response.generations:
                gen = response.generations[0][0]
                text = getattr(gen, "text", "") or ""
                if not text and hasattr(gen, "message"):
                    text = getattr(gen.message, "content", "") or ""
            if text and len(text) > 20:
                self._collector.add_message("assistant", text)
        except Exception:
            pass

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:
        """收集工具调用"""
        try:
            name = serialized.get("name", "unknown")
            self._collector.add_message("assistant", f"[TOOL: {name}] {input_str[:500]}")
        except Exception:
            pass

    def on_tool_end(self, output: str, **kwargs: Any) -> None:
        """收集工具结果"""
        try:
            self._collector.add_tool_call("", "", output)
        except Exception:
            pass

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        **kwargs: Any,
    ) -> None:
        """收集用户消息"""
        try:
            for msg_group in messages:
                for msg in msg_group:
                    role = getattr(msg, "type", "unknown")
                    content = getattr(msg, "content", "")
                    if role == "human" and content and len(content) <= 3000:
                        self._collector.add_message("user", content)
        except Exception:
            pass

    def flush(self) -> Any:
        """提交采集的消息"""
        return self._collector.flush()

    def reset(self) -> None:
        """重置"""
        self._collector.reset()

    @property
    def message_count(self) -> int:
        return self._collector.message_count
