"""
SBS 人格原语提取器
从聚类结果中提取结构化人格维度
"""

from __future__ import annotations

import json
import logging
from typing import Callable

logger = logging.getLogger("sbs.extractor")

# 工作技能轨的提取维度
WORK_DIMENSIONS = [
    "专业领域与技术栈",
    "决策风格与方法论",
    "问题解决策略",
    "工作流与效率习惯",
    "技术偏好与原则",
    "团队协作风格",
    "学习方式与知识获取",
    "代码/写作风格",
    "项目管理倾向",
    "技术观点与立场",
]

# 人格特征轨的提取维度
PERSONALITY_DIMENSIONS = [
    "语气与表达风格",
    "幽默感类型",
    "核心价值观",
    "情感表达方式",
    "社交风格与人际偏好",
    "思维模式（直觉型/分析型）",
    "对待冲突的态度",
    "自我认知与反思倾向",
    "兴趣爱好与品味",
    "人生态度与哲学",
]


def extract_track(
    clusters: list[dict],
    track: str,
    llm_fn: Callable[[str], str],
) -> dict:
    """
    单轨人格提取

    track: "work" 或 "personality"
    llm_fn: 接受 prompt 返回 str 的函数
    """
    dimensions = WORK_DIMENSIONS if track == "work" else PERSONALITY_DIMENSIONS
    track_label = "工作技能" if track == "work" else "人格特征"

    logger.info(f"[{track_label}轨] 提取 {len(dimensions)} 个维度...")

    results: dict = {
        "track": track,
        "dimensions": [],
    }

    for dim_name in dimensions:
        logger.info(f"  提取维度: {dim_name}")

        # 从各聚类中收集相关文本
        relevant_texts = []
        for cluster in clusters:
            samples = cluster["texts"][:5]
            relevant_texts.extend(samples)

        # 限制上下文长度
        context = "\n---\n".join(relevant_texts[:20])

        prompt = f"""你是一个人格分析专家。根据以下文本样本，提取关于目标人物在「{dim_name}」这个维度上的特征。

文本样本：
{context}

请严格按照以下 JSON 格式输出（不要输出其他内容）：
{{
  "dimension": "{dim_name}",
  "statements": [
    "关于该维度的具体人格陈述1（20-50字，需有证据支撑）",
    "关于该维度的具体人格陈述2",
    "关于该维度的具体人格陈述3"
  ],
  "confidence": 0.8,
  "evidence_snippets": ["原文中的关键片段1", "原文中的关键片段2"]
}}"""

        try:
            response = llm_fn(prompt)
            # 尝试从回复中提取 JSON
            dim_data = _parse_json_response(response)
            dim_data["dimension"] = dim_name
            n_stmts = len(dim_data.get("statements", []))
            conf = dim_data.get("confidence", 0)
            logger.info(f"  ✓ [{dim_name}] → {n_stmts} 条陈述 (置信度 {conf:.1f})")
            results["dimensions"].append(dim_data)
        except Exception as e:
            logger.warning(f"  ✗ [{dim_name}] 提取失败: {e}")
            results["dimensions"].append({
                "dimension": dim_name,
                "statements": [],
                "confidence": 0.0,
                "evidence_snippets": [],
            })

    logger.info(f"[{track_label}轨] 提取完成: {len(results['dimensions'])} 个维度")
    return results


def merge_tracks(track_a: dict, track_b: dict) -> dict:
    """合并双轨结果"""
    return {
        "dimensions": track_a.get("dimensions", []) + track_b.get("dimensions", []),
        "work_track": track_a,
        "personality_track": track_b,
    }


def _parse_json_response(text: str) -> dict:
    """从 LLM 回复中提取 JSON，兼容思考模式前缀文本"""
    import re
    text = text.strip()

    # 先尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试提取 ```json ... ``` 块
    m = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 从每个 { 位置扫描完整 JSON 对象，收集全部候选，取最后一个含 statements 字段的
    candidates = []
    pos = 0
    while True:
        start = text.find("{", pos)
        if start < 0:
            break
        depth = 0
        in_string = False
        escape = False
        end = -1
        for i, c in enumerate(text[start:], start):
            if escape:
                escape = False
                continue
            if c == "\\" and in_string:
                escape = True
                continue
            if c == '"':
                in_string = not in_string
                continue
            if not in_string:
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
        if end > start:
            try:
                obj = json.loads(text[start:end])
                if isinstance(obj, dict):
                    candidates.append(obj)
            except json.JSONDecodeError:
                pass
        pos = start + 1

    # 优先返回最后一个含 statements 字段的候选（最终答案），否则最后一个有效对象
    for obj in reversed(candidates):
        if "statements" in obj:
            return obj
    if candidates:
        return candidates[-1]

    raise ValueError(f"无法从回复中解析 JSON: {text[:200]}")
