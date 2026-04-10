"""自动经验采集测试"""

import json
import pytest
from unittest.mock import patch, MagicMock
from io import BytesIO

from agentxp.auto_extract import AutoExtract, auto_extract
from agentxp.types import AutoExtractResult


class TestAutoExtractBasic:
    def test_add_message(self):
        ae = AutoExtract(api_key="test-key")
        ae.add_message("user", "Hello")
        ae.add_message("assistant", "Hi there")
        assert ae.message_count == 2

    def test_message_truncation(self):
        ae = AutoExtract(api_key="test-key", max_message_chars=50)
        ae.add_message("user", "x" * 100)
        assert len(ae._messages[0]["content"]) == 50

    def test_skip_long_system_message(self):
        ae = AutoExtract(api_key="test-key")
        ae.add_message("system", "x" * 5000)
        assert ae.message_count == 0

    def test_short_system_message_kept(self):
        ae = AutoExtract(api_key="test-key")
        ae.add_message("system", "You are a helpful assistant")
        assert ae.message_count == 1

    def test_add_tool_call_interesting(self):
        ae = AutoExtract(api_key="test-key")
        ae.add_tool_call("exec", "ls -la", "error: permission denied")
        assert ae.message_count == 2  # 调用 + 结果

    def test_add_tool_call_boring(self):
        ae = AutoExtract(api_key="test-key")
        ae.add_tool_call("exec", "ls -la", "a" * 500)  # 长且无关键词
        assert ae.message_count == 1  # 只有调用，结果被跳过

    def test_add_tool_call_short_result(self):
        ae = AutoExtract(api_key="test-key")
        ae.add_tool_call("read", "file.txt", "OK")
        assert ae.message_count == 2  # 短结果保留


class TestAutoExtractFlush:
    def test_too_few_messages(self):
        ae = AutoExtract(api_key="test-key", min_messages=5)
        ae.add_message("user", "hi")
        ae.add_message("assistant", "hello")
        result = ae.flush()
        assert result.status == "skipped"
        assert "Too few" in result.skip_reason

    def test_no_api_key(self):
        ae = AutoExtract(api_key="", min_messages=1)
        ae.add_message("user", "test")
        result = ae.flush()
        assert result.status == "error"
        assert "API key" in result.error

    def test_double_flush(self):
        ae = AutoExtract(api_key="test-key", min_messages=1)
        ae.add_message("user", "test")
        # mock the HTTP call
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "status": "extracted",
            "published": [],
            "rejected": [],
        }).encode()
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)

        with patch("agentxp.auto_extract.urlopen", return_value=mock_response):
            result1 = ae.flush()
            result2 = ae.flush()

        assert result1 is not None
        assert result2 is None  # 第二次返回 None

    def test_successful_flush(self):
        ae = AutoExtract(api_key="test-key", min_messages=1, agent_name="test-agent")
        ae.add_message("user", "Fix Docker build")
        ae.add_message("assistant", "Found the issue with COPY --chmod")

        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "status": "extracted",
            "published": [{"experience_id": "exp_1", "what": "Fixed Docker", "tags": ["docker"]}],
            "rejected": [],
        }).encode()
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)

        with patch("agentxp.auto_extract.urlopen", return_value=mock_response) as mock_url:
            result = ae.flush()

        assert result.status == "extracted"
        assert len(result.published) == 1

        # 验证请求内容
        call_args = mock_url.call_args
        req = call_args[0][0]
        body = json.loads(req.data.decode())
        assert body["metadata"]["agent_name"] == "test-agent"
        assert body["metadata"]["framework"] == "python-sdk"
        assert len(body["messages"]) == 2

    def test_on_extracted_callback(self):
        results = []
        ae = AutoExtract(
            api_key="test-key",
            min_messages=1,
            on_extracted=lambda r: results.append(r),
        )
        ae.add_message("user", "test")

        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"status": "extracted"}).encode()
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)

        with patch("agentxp.auto_extract.urlopen", return_value=mock_response):
            ae.flush()

        assert len(results) == 1
        assert results[0].status == "extracted"

    def test_on_error_callback(self):
        errors = []
        ae = AutoExtract(
            api_key="",
            min_messages=1,
            on_error=lambda e: errors.append(e),
        )
        ae.add_message("user", "test")
        ae.flush()
        assert len(errors) == 1

    def test_http_error(self):
        from urllib.error import HTTPError

        ae = AutoExtract(api_key="test-key", min_messages=1)
        ae.add_message("user", "test")

        err = HTTPError(
            "http://test",
            429,
            "Too Many Requests",
            {},
            BytesIO(json.dumps({"error": "Rate limited"}).encode()),
        )

        with patch("agentxp.auto_extract.urlopen", side_effect=err):
            result = ae.flush()

        assert result.status == "error"
        assert "Rate limited" in result.error


class TestAutoExtractContextManager:
    def test_context_manager(self):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"status": "skipped", "skip_reason": "test"}).encode()
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)

        with AutoExtract(api_key="test-key", min_messages=1) as ae:
            ae.add_message("user", "test")
            # with patch 可以在外面
            with patch("agentxp.auto_extract.urlopen", return_value=mock_response):
                pass  # flush 发生在 __exit__

        # 验证 __exit__ 触发了 flush
        assert ae._flushed

    def test_context_manager_flushes_on_exception(self):
        ae = AutoExtract(api_key="test-key", min_messages=100)
        try:
            with ae:
                ae.add_message("user", "test")
                raise ValueError("test error")
        except ValueError:
            pass

        assert ae._flushed  # 即使异常也 flush


class TestAutoExtractReset:
    def test_reset(self):
        ae = AutoExtract(api_key="test-key")
        ae.add_message("user", "hello")
        assert ae.message_count == 1
        ae.reset()
        assert ae.message_count == 0
        assert not ae._flushed


class TestAutoExtractDecorator:
    def test_decorator(self):
        ae = AutoExtract(api_key="test-key", min_messages=100)

        @ae
        def my_func(msg):
            return f"processed: {msg}"

        result = my_func("hello")
        assert result == "processed: hello"
        assert ae._flushed

    def test_auto_extract_shortcut(self):
        ae = auto_extract(api_key="test-key", min_messages=100)
        assert isinstance(ae, AutoExtract)
