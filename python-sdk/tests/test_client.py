"""AgentXP 客户端测试"""

import json
import pytest
from unittest.mock import patch, MagicMock
from io import BytesIO
from urllib.error import HTTPError

from agentxp.client import AgentXP, AgentXPError


def mock_urlopen(response_data, status=200):
    """创建 mock urlopen 响应"""
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(response_data).encode()
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


class TestAgentXPInit:
    def test_default_config(self):
        client = AgentXP(api_key="test-key")
        assert client.api_key == "test-key"
        assert client.server_url == "https://agentxp.io"
        assert client.platform == "python"

    def test_custom_config(self):
        client = AgentXP(
            api_key="my-key",
            server_url="http://localhost:3141/",
            agent_id="my-agent",
            platform="custom",
            timeout=60,
        )
        assert client.api_key == "my-key"
        assert client.server_url == "http://localhost:3141"  # 尾部斜杠被去掉
        assert client.agent_id == "my-agent"
        assert client.timeout == 60

    def test_env_var_fallback(self):
        with patch.dict("os.environ", {"AGENTXP_API_KEY": "env-key", "AGENTXP_SERVER_URL": "http://env-server"}):
            client = AgentXP()
            assert client.api_key == "env-key"
            assert client.server_url == "http://env-server"


class TestAgentXPAutoRegister:
    def test_auto_register(self):
        client = AgentXP(api_key="", agent_id="test-agent")

        # 第一次调用注册
        register_resp = mock_urlopen({"api_key": "auto-key-123"})
        # 第二次调用搜索
        search_resp = mock_urlopen({"precision": [], "serendipity": [], "total_available": 0})

        with patch("agentxp.client.urlopen", side_effect=[register_resp, search_resp]):
            result = client.search("test query")

        assert client.api_key == "auto-key-123"

    def test_register_failure(self):
        client = AgentXP(api_key="", agent_id="test-agent")

        err = HTTPError(
            "http://test/register",
            500,
            "Server Error",
            {},
            BytesIO(json.dumps({"error": "Internal error"}).encode()),
        )

        with patch("agentxp.client.urlopen", side_effect=err):
            with pytest.raises(AgentXPError) as exc_info:
                client.search("test")
            assert "500" in str(exc_info.value)


class TestAgentXPSearch:
    def test_basic_search(self):
        client = AgentXP(api_key="test-key")

        resp = mock_urlopen({
            "precision": [
                {
                    "experience_id": "exp_1",
                    "match_score": 0.85,
                    "experience": {
                        "core": {"what": "Docker fix", "tried": "x", "learned": "y"},
                    },
                    "verification_summary": {"total": 2, "confirmed": 1},
                }
            ],
            "serendipity": [],
            "total_available": 100,
        })

        with patch("agentxp.client.urlopen", return_value=resp) as mock_url:
            result = client.search("Docker build fails")

        assert len(result.precision) == 1
        assert result.precision[0].experience_id == "exp_1"
        assert result.total_available == 100

        # 验证请求体
        req = mock_url.call_args[0][0]
        body = json.loads(req.data.decode())
        assert body["query"] == "Docker build fails"

    def test_search_with_filters(self):
        client = AgentXP(api_key="test-key")
        resp = mock_urlopen({"precision": [], "serendipity": [], "total_available": 0})

        with patch("agentxp.client.urlopen", return_value=resp) as mock_url:
            client.search("test", tags=["docker", "nginx"], outcome="failed", limit=5)

        req = mock_url.call_args[0][0]
        body = json.loads(req.data.decode())
        assert body["tags"] == ["docker", "nginx"]
        assert body["outcome"] == "failed"
        assert body["limit"] == 5

    def test_search_error(self):
        client = AgentXP(api_key="test-key")

        err = HTTPError(
            "http://test/api/search",
            401,
            "Unauthorized",
            {},
            BytesIO(json.dumps({"error": "Invalid API key"}).encode()),
        )

        with patch("agentxp.client.urlopen", side_effect=err):
            with pytest.raises(AgentXPError) as exc_info:
                client.search("test")
            assert exc_info.value.status_code == 401


class TestAgentXPPublish:
    def test_basic_publish(self):
        client = AgentXP(api_key="test-key", agent_id="my-agent")

        resp = mock_urlopen({
            "status": "published",
            "experience_id": "exp_new",
            "indexed_tags": ["docker"],
            "published_at": "2026-04-10T18:00:00Z",
        })

        with patch("agentxp.client.urlopen", return_value=resp) as mock_url:
            result = client.publish(
                what="Fixed Docker build",
                tried="Used COPY --chmod",
                learned="Needs DOCKER_BUILDKIT=1",
                tags=["docker"],
                outcome="succeeded",
            )

        assert result.status == "published"
        assert result.experience_id == "exp_new"

        req = mock_url.call_args[0][0]
        body = json.loads(req.data.decode())
        assert body["experience"]["core"]["what"] == "Fixed Docker build"
        assert body["experience"]["core"]["outcome"] == "succeeded"
        assert body["experience"]["publisher"]["platform"] == "python"
        assert body["experience"]["publisher"]["agent_id"] == "my-agent"

    def test_publish_private(self):
        client = AgentXP(api_key="test-key")

        resp = mock_urlopen({"status": "published", "experience_id": "exp_priv"})

        with patch("agentxp.client.urlopen", return_value=resp) as mock_url:
            client.publish(
                what="Internal fix",
                tried="x",
                learned="y",
                visibility="private",
                operator="my-org",
            )

        req = mock_url.call_args[0][0]
        body = json.loads(req.data.decode())
        assert body["experience"]["visibility"] == "private"
        assert body["experience"]["publisher"]["operator"] == "my-org"

    def test_publish_with_version(self):
        client = AgentXP(api_key="test-key")

        resp = mock_urlopen({"status": "published", "experience_id": "exp_ver"})

        with patch("agentxp.client.urlopen", return_value=resp) as mock_url:
            client.publish(
                what="Version test",
                tried="x",
                learned="y",
                context_version="Docker 24.0 + BuildKit 0.12",
            )

        req = mock_url.call_args[0][0]
        body = json.loads(req.data.decode())
        assert body["experience"]["context_version"] == "Docker 24.0 + BuildKit 0.12"


class TestAgentXPVerify:
    def test_basic_verify(self):
        client = AgentXP(api_key="test-key")

        resp = mock_urlopen({
            "status": "recorded",
            "verification_id": "ver_1",
            "experience_verification_summary": {"total": 3, "confirmed": 2},
        })

        with patch("agentxp.client.urlopen", return_value=resp) as mock_url:
            result = client.verify(
                experience_id="exp_123",
                result="confirmed",
                notes="Works on my machine",
                environment="Docker 24.0 on Ubuntu 22.04",
            )

        assert result.status == "recorded"

        req = mock_url.call_args[0][0]
        body = json.loads(req.data.decode())
        assert body["experience_id"] == "exp_123"
        assert body["result"] == "confirmed"
        assert body["notes"] == "Works on my machine"
        assert body["environment"] == "Docker 24.0 on Ubuntu 22.04"

    def test_verify_conditional(self):
        client = AgentXP(api_key="test-key")

        resp = mock_urlopen({"status": "recorded", "verification_id": "ver_2"})

        with patch("agentxp.client.urlopen", return_value=resp) as mock_url:
            client.verify(
                experience_id="exp_456",
                result="conditional",
                conditions="Only works with BuildKit enabled",
            )

        req = mock_url.call_args[0][0]
        body = json.loads(req.data.decode())
        assert body["result"] == "conditional"
        assert body["conditions"] == "Only works with BuildKit enabled"


class TestAgentXPError:
    def test_connection_error(self):
        from urllib.error import URLError
        client = AgentXP(api_key="test-key", server_url="http://nonexistent:9999")

        with patch("agentxp.client.urlopen", side_effect=URLError("Connection refused")):
            with pytest.raises(AgentXPError) as exc_info:
                client.search("test")
            assert "连接失败" in str(exc_info.value)
