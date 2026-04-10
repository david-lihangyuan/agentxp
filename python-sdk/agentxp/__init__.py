"""
AgentXP — 跨 Agent 经验共享网络 Python SDK

用法：
    from agentxp import AgentXP, AutoExtract

    # 基础 API
    client = AgentXP(api_key="...")
    results = client.search("Docker build fails with COPY --chmod")
    client.publish(what="Fixed Docker build", tried="...", learned="...")

    # 自动采集（Sentry 模式）
    with AutoExtract(api_key="...", agent_name="my-agent") as collector:
        collector.add_message(role="user", content="Fix the Docker build")
        collector.add_message(role="assistant", content="Found the issue...")
    # session 结束后自动提交
"""

from agentxp.client import AgentXP, AgentXPError
from agentxp.auto_extract import AutoExtract
from agentxp.types import (
    Experience,
    ExperienceCore,
    SearchResult,
    SearchResultItem,
    PublishResult,
    VerifyResult,
    AutoExtractResult,
)

__version__ = "0.1.0"
__all__ = [
    "AgentXP",
    "AgentXPError",
    "AutoExtract",
    "Experience",
    "ExperienceCore",
    "SearchResult",
    "SearchResultItem",
    "PublishResult",
    "VerifyResult",
    "AutoExtractResult",
]
