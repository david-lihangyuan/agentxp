"""
AgentXP 自动经验采集 — Sentry 模式

用法 1 — Context manager：
    with AutoExtract(api_key="...", agent_name="my-agent") as collector:
        collector.add_message(role="user", content="Fix the Docker build")
        collector.add_message(role="assistant", content="Found the issue...")
    # session 结束后自动提交

用法 2 — 装饰器：
    @auto_extract(api_key="...", agent_name="my-agent")
    def run_agent(messages):
        return agent.invoke(messages)

用法 3 — 手动控制：
    collector = AutoExtract(api_key="...")
    collector.add_message(role="user", content="...")
    collector.add_message(role="assistant", content="...")
    result = collector.flush()
"""

from __future__ import annotations

import functools
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from agentxp.types import AutoExtractResult

logger = logging.getLogger("agentxp.auto_extract")


class AutoExtract:
    """自动经验采集器

    收集 agent session 的消息，session 结束后自动提交到
    AgentXP webhook 进行 LLM 提取。

    Args:
        api_key: API 密钥。默认从 AGENTXP_API_KEY 环境变量读取。
        server_url: API 服务地址。默认 https://agentxp.io
        agent_name: Agent 名称（用于 metadata）。
        agent_id: Agent ID（用于 metadata）。
        min_messages: 最少消息数，少于此数不提交（默认 5）。
        max_message_chars: 每条消息最大字符数（默认 1000）。
        dry_run: True = 只看提取结果不发布。
        platform: 平台标识（默认 "python"）。
        on_extracted: 提取完成回调。
        on_error: 错误回调（默认记日志）。
        timeout: HTTP 请求超时秒数（默认 30）。
    """

    def __init__(
        self,
        api_key: str = "",
        server_url: str = "",
        agent_name: str = "python-agent",
        agent_id: str = "",
        min_messages: int = 5,
        max_message_chars: int = 1000,
        dry_run: bool = False,
        platform: str = "python",
        on_extracted: Callable[[AutoExtractResult], None] | None = None,
        on_error: Callable[[Exception], None] | None = None,
        timeout: int = 30,
    ):
        self.api_key = api_key or os.environ.get("AGENTXP_API_KEY", "")
        self.server_url = (
            server_url or os.environ.get("AGENTXP_SERVER_URL", "https://agentxp.io")
        ).rstrip("/")
        self.agent_name = agent_name
        self.agent_id = agent_id or os.environ.get("AGENTXP_AGENT_ID", f"python-{os.getpid()}")
        self.min_messages = min_messages
        self.max_message_chars = max_message_chars
        self.dry_run = dry_run
        self.platform = platform
        self.on_extracted = on_extracted
        self.on_error = on_error
        self.timeout = timeout

        self._messages: list[dict[str, str]] = []
        self._flushed = False

    # ── 消息收集 ────────────────────────────────────────

    def add_message(self, role: str, content: str) -> None:
        """添加一条消息

        Args:
            role: 角色（user/assistant/tool/system）
            content: 消息内容

        系统消息超过 3000 字符会被自动跳过。
        """
        # 跳过长系统 prompt
        if role == "system" and len(content) > 3000:
            return

        self._messages.append({
            "role": role,
            "content": content[: self.max_message_chars],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    def add_tool_call(self, tool_name: str, args: str, result: str = "") -> None:
        """添加一次工具调用（便捷方法）

        Args:
            tool_name: 工具名称
            args: 调用参数
            result: 工具返回结果（可选）
        """
        self.add_message("assistant", f"[TOOL: {tool_name}] {args[:500]}")
        if result:
            # 只保留有价值的结果
            lower = result.lower()
            interesting = any(
                kw in lower
                for kw in ("error", "fail", "warning", "not found", "cannot",
                           "fix", "bug", "deploy", "pass", "success")
            )
            if interesting or len(result) < 200:
                self.add_message("tool", result[:500])

    @property
    def message_count(self) -> int:
        """当前收集的消息数"""
        return len(self._messages)

    # ── 提交 ────────────────────────────────────────────

    def flush(self) -> AutoExtractResult | None:
        """提交收集的消息到 auto-extract webhook

        Returns:
            AutoExtractResult 或 None（如果已经提交过）
        """
        if self._flushed:
            return None
        self._flushed = True

        # 消息太少
        if len(self._messages) < self.min_messages:
            result = AutoExtractResult(
                status="skipped",
                skip_reason=f"Too few messages ({len(self._messages)} < {self.min_messages})",
            )
            if self.on_extracted:
                self.on_extracted(result)
            return result

        # 没有 API key
        if not self.api_key:
            result = AutoExtractResult(
                status="error",
                error="No API key configured (set AGENTXP_API_KEY or pass api_key)",
            )
            if self.on_error:
                self.on_error(ValueError(result.error))
            else:
                logger.warning("AgentXP: %s", result.error)
            return result

        # 发送请求
        try:
            body = json.dumps({
                "messages": self._messages,
                "metadata": {
                    "agent_id": self.agent_id,
                    "agent_name": self.agent_name,
                    "platform": self.platform,
                    "framework": "python-sdk",
                },
                "dry_run": self.dry_run,
            }).encode("utf-8")

            req = Request(
                f"{self.server_url}/hooks/auto-extract",
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}",
                },
                method="POST",
            )

            with urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            result = AutoExtractResult.from_dict(data)
            if self.on_extracted:
                self.on_extracted(result)
            return result

        except (HTTPError, URLError, Exception) as e:
            error_msg = str(e)
            if isinstance(e, HTTPError):
                try:
                    err_body = json.loads(e.read().decode("utf-8"))
                    error_msg = err_body.get("error", str(e))
                except Exception:
                    pass

            result = AutoExtractResult(status="error", error=error_msg)
            if self.on_error:
                self.on_error(e)
            else:
                logger.warning("AgentXP auto-extract failed: %s", error_msg)
            return result

    def reset(self) -> None:
        """重置收集器（开始新 session）"""
        self._messages = []
        self._flushed = False

    # ── Context Manager ─────────────────────────────────

    def __enter__(self) -> AutoExtract:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """退出时自动 flush（即使有异常也提交，因为异常 session 往往更有价值）"""
        if not self._flushed:
            self.flush()

    # ── Decorator ───────────────────────────────────────

    def __call__(self, func: Callable) -> Callable:
        """作为装饰器使用

        被装饰的函数的返回值如果是字符串，会被当作 assistant 消息收集。

        用法：
            @AutoExtract(api_key="...", agent_name="my-agent")
            def run_agent(user_input):
                # 做事...
                return response
        """

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            self.reset()

            # 尝试从第一个参数收集 user 消息
            if args and isinstance(args[0], str):
                self.add_message("user", args[0])
            elif "messages" in kwargs and isinstance(kwargs["messages"], list):
                for msg in kwargs["messages"]:
                    if isinstance(msg, dict) and "role" in msg and "content" in msg:
                        self.add_message(msg["role"], msg["content"])

            try:
                result = func(*args, **kwargs)
                # 收集返回值
                if isinstance(result, str):
                    self.add_message("assistant", result)
                return result
            finally:
                self.flush()

        return wrapper


def auto_extract(**kwargs: Any) -> AutoExtract:
    """创建 AutoExtract 装饰器的便捷函数

    用法：
        @auto_extract(api_key="...", agent_name="my-agent")
        def run_agent(messages):
            return agent.invoke(messages)
    """
    return AutoExtract(**kwargs)
