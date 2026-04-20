"""
SBS LLM 客户端
统一的 LLM 调用接口，支持本地服务（OpenAI 兼容 API）
"""

from __future__ import annotations

import json
import logging
import time
from urllib.request import Request, urlopen
from urllib.error import URLError

logger = logging.getLogger("sbs.llm_client")

MAX_RETRIES = 3
RETRY_DELAY = 2


class LLMClient:
    """调用本地 LLM 服务的客户端"""

    def __init__(self, base_url: str = "http://127.0.0.1:8000"):
        self.base_url = base_url.rstrip("/")

    def chat(
        self,
        prompt: str,
        system: str = "你是一个专业的人格分析助手。",
        max_tokens: int = 8192,
        temperature: float = 0.7,
    ) -> str:
        """发送聊天请求"""
        payload = {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                data = json.dumps(payload).encode("utf-8")
                req = Request(
                    f"{self.base_url}/v1/chat/completions",
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                t0 = time.time()
                logger.info(f"  → LLM 请求中... (max_tokens={max_tokens})")
                with urlopen(req, timeout=300) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                    elapsed = time.time() - t0
                    # Support both OpenAI-standard format and our custom server format
                    if "choices" in result:
                        msg = result["choices"][0]["message"]
                        content = msg.get("content", "").strip()
                        # If content is empty (thinking chain exhausted max_tokens),
                        # fall back to reasoning_content as last resort
                        if not content:
                            content = msg.get("reasoning_content", "")
                            if content:
                                logger.warning(f"  content 为空（思考链超 token），已回退 reasoning_content ({elapsed:.1f}s)")
                        else:
                            logger.info(f"  ✓ LLM 响应完成 ({elapsed:.1f}s, {len(content)} 字符)")
                        return content
                    elapsed = time.time() - t0
                    logger.info(f"  ✓ LLM 响应完成 ({elapsed:.1f}s)")
                    return result.get("content", "")
            except (URLError, TimeoutError, json.JSONDecodeError) as e:
                logger.warning(f"LLM 请求失败 (第 {attempt} 次): {e}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY * attempt)
                else:
                    raise RuntimeError(f"LLM 服务不可达 ({self.base_url}): {e}") from e

        return ""

    def health_check(self) -> bool:
        """检查 LLM 服务是否可用（兼容 SBS server /health 和 LM Studio /v1/models）"""
        for path in ("/health", "/v1/models"):
            try:
                req = Request(f"{self.base_url}{path}", method="GET")
                with urlopen(req, timeout=5) as resp:
                    if resp.status == 200:
                        return True
            except Exception:
                continue
        return False
