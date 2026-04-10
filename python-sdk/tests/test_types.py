"""类型定义测试"""

import pytest
from agentxp.types import (
    ExperienceCore,
    SearchResult,
    SearchResultItem,
    PublishResult,
    VerifyResult,
    AutoExtractResult,
)


class TestExperienceCore:
    def test_basic_creation(self):
        core = ExperienceCore(
            what="Fixed Docker build",
            tried="Used COPY --chmod",
            learned="Needs DOCKER_BUILDKIT=1",
        )
        assert core.what == "Fixed Docker build"
        assert core.outcome == "inconclusive"  # 默认值
        assert core.context == ""

    def test_full_creation(self):
        core = ExperienceCore(
            what="Fixed Docker build",
            tried="Used COPY --chmod",
            learned="Needs DOCKER_BUILDKIT=1",
            context="Docker 24.0 on Ubuntu 22.04",
            outcome="succeeded",
            outcome_detail="Build completed after enabling BuildKit",
        )
        assert core.outcome == "succeeded"


class TestSearchResult:
    def test_from_dict_empty(self):
        result = SearchResult.from_dict({})
        assert result.precision == []
        assert result.serendipity == []
        assert result.total_available == 0

    def test_from_dict_full(self):
        data = {
            "precision": [
                {
                    "experience_id": "exp_123",
                    "match_score": 0.85,
                    "experience": {
                        "core": {"what": "test", "tried": "x", "learned": "y"},
                        "tags": ["docker"],
                    },
                    "verification_summary": {"total": 3, "confirmed": 2},
                    "failure_warning": "",
                    "verified_environments": ["Ubuntu 22.04"],
                }
            ],
            "serendipity": [],
            "total_available": 50,
        }
        result = SearchResult.from_dict(data)
        assert len(result.precision) == 1
        assert result.precision[0].experience_id == "exp_123"
        assert result.precision[0].match_score == 0.85
        assert result.precision[0].verified_environments == ["Ubuntu 22.04"]
        assert result.total_available == 50


class TestPublishResult:
    def test_from_dict(self):
        data = {
            "status": "published",
            "experience_id": "exp_abc",
            "indexed_tags": ["docker", "nginx"],
            "published_at": "2026-04-10T18:00:00Z",
            "warnings": [{"type": "possible_api_key", "severity": "high"}],
        }
        result = PublishResult.from_dict(data)
        assert result.status == "published"
        assert result.experience_id == "exp_abc"
        assert len(result.warnings) == 1


class TestVerifyResult:
    def test_from_dict(self):
        data = {
            "status": "recorded",
            "verification_id": "ver_xyz",
            "experience_verification_summary": {
                "total": 5,
                "confirmed": 3,
                "denied": 1,
                "conditional": 1,
            },
        }
        result = VerifyResult.from_dict(data)
        assert result.status == "recorded"
        assert result.experience_verification_summary["confirmed"] == 3


class TestAutoExtractResult:
    def test_from_dict_extracted(self):
        data = {
            "status": "extracted",
            "published": [
                {"experience_id": "exp_1", "what": "Fixed X", "tags": ["docker"]}
            ],
            "rejected": [
                {"what": "Generic advice", "reason": "specificity too low"}
            ],
        }
        result = AutoExtractResult.from_dict(data)
        assert result.status == "extracted"
        assert len(result.published) == 1
        assert len(result.rejected) == 1

    def test_from_dict_skipped(self):
        data = {"status": "skipped", "skip_reason": "Too few messages"}
        result = AutoExtractResult.from_dict(data)
        assert result.status == "skipped"
        assert "Too few" in result.skip_reason

    def test_from_dict_error(self):
        data = {"status": "error", "error": "Rate limited"}
        result = AutoExtractResult.from_dict(data)
        assert result.status == "error"
        assert result.error == "Rate limited"
