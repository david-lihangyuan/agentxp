"""AgentXP 类型定义"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ExperienceCore:
    """经验核心内容"""
    what: str
    tried: str
    learned: str
    context: str = ""
    outcome: str = "inconclusive"  # succeeded | failed | partial | inconclusive
    outcome_detail: str = ""


@dataclass
class Publisher:
    """发布者信息"""
    platform: str = "python"
    agent_id: str = ""
    operator: str = ""


@dataclass
class Experience:
    """完整经验对象"""
    core: ExperienceCore
    tags: list[str] = field(default_factory=list)
    publisher: Publisher = field(default_factory=Publisher)
    visibility: str = "public"  # public | private
    context_version: str = ""
    status: str = "active"  # active | outdated | retracted


@dataclass
class VerificationSummary:
    """验证摘要"""
    total: int = 0
    confirmed: int = 0
    denied: int = 0
    conditional: int = 0


@dataclass
class SearchResultItem:
    """搜索结果条目"""
    experience_id: str = ""
    match_score: float = 0.0
    experience: dict[str, Any] = field(default_factory=dict)
    verification_summary: dict[str, Any] = field(default_factory=dict)
    failure_warning: str = ""
    verified_environments: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> SearchResultItem:
        return cls(
            experience_id=data.get("experience_id", ""),
            match_score=data.get("match_score", 0.0),
            experience=data.get("experience", {}),
            verification_summary=data.get("verification_summary", {}),
            failure_warning=data.get("failure_warning", ""),
            verified_environments=data.get("verified_environments", []),
        )


@dataclass
class SearchResult:
    """搜索结果"""
    precision: list[SearchResultItem] = field(default_factory=list)
    serendipity: list[SearchResultItem] = field(default_factory=list)
    total_available: int = 0

    @classmethod
    def from_dict(cls, data: dict) -> SearchResult:
        return cls(
            precision=[SearchResultItem.from_dict(item) for item in data.get("precision", [])],
            serendipity=[SearchResultItem.from_dict(item) for item in data.get("serendipity", [])],
            total_available=data.get("total_available", 0),
        )


@dataclass
class PublishResult:
    """发布结果"""
    status: str = ""
    experience_id: str = ""
    indexed_tags: list[str] = field(default_factory=list)
    published_at: str = ""
    warnings: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> PublishResult:
        return cls(
            status=data.get("status", ""),
            experience_id=data.get("experience_id", ""),
            indexed_tags=data.get("indexed_tags", []),
            published_at=data.get("published_at", ""),
            warnings=data.get("warnings", []),
        )


@dataclass
class VerifyResult:
    """验证结果"""
    status: str = ""
    verification_id: str = ""
    experience_verification_summary: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict) -> VerifyResult:
        return cls(
            status=data.get("status", ""),
            verification_id=data.get("verification_id", ""),
            experience_verification_summary=data.get("experience_verification_summary", {}),
        )


@dataclass
class AutoExtractResult:
    """自动提取结果"""
    status: str = ""  # extracted | skipped | empty | error
    published: list[dict[str, Any]] = field(default_factory=list)
    rejected: list[dict[str, Any]] = field(default_factory=list)
    skip_reason: str = ""
    error: str = ""

    @classmethod
    def from_dict(cls, data: dict) -> AutoExtractResult:
        return cls(
            status=data.get("status", ""),
            published=data.get("published", []),
            rejected=data.get("rejected", []),
            skip_reason=data.get("skip_reason", ""),
            error=data.get("error", ""),
        )
