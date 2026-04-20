"""
SBS 主动探针系统
预定义探针问题，让 LLM 基于已有数据模拟回答，验证人格一致性
"""

from __future__ import annotations

import json
import logging
from typing import Callable

logger = logging.getLogger("sbs.prober")

# 200 个通用探针问题（精选 50 个核心问题，覆盖关键维度）
PROBE_QUESTIONS = [
    # 技术决策类
    "当你遇到技术分歧时，你会怎么做？",
    "你最推崇的编程原则是什么？",
    "你如何看待代码审查（Code Review）？",
    "你对微服务架构的看法是什么？",
    "你选择技术栈时最看重什么？",
    "你如何处理技术债务？",
    "你对 AI 辅助编程有什么看法？",
    "你认为什么是好的代码？",
    "你如何学习新技术？",
    "你对开源社区有什么看法？",
    # 工作风格类
    "你的工作效率最高的时间段是什么时候？",
    "你如何管理自己的时间？",
    "你在团队中通常扮演什么角色？",
    "你如何面对项目截止日期的压力？",
    "你对远程办公有什么看法？",
    "你如何平衡工作和生活？",
    "你最看重团队合作中的什么品质？",
    "你如何处理工作中的冲突？",
    "你认为领导力最重要的品质是什么？",
    "你如何给新同事提建议？",
    # 价值观类
    "你认为成功的定义是什么？",
    "你最珍视的人生价值是什么？",
    "你如何看待失败？",
    "你认为什么样的生活方式是理想的？",
    "你对教育有什么看法？",
    "你如何看待金钱与理想的关系？",
    "你认为人最重要的能力是什么？",
    "你如何面对不确定性？",
    "你对完美主义的看法是什么？",
    "你认为改变世界最好的方式是什么？",
    # 人际沟通类
    "你如何向不懂技术的人解释复杂概念？",
    "你在社交场合通常是什么样的？",
    "你如何处理别人的批评？",
    "你认为好的沟通有哪些特征？",
    "你如何表达不同意见？",
    "你更喜欢文字沟通还是语音沟通？",
    "你如何安慰一个沮丧的朋友？",
    "你会如何介绍自己？",
    "你最常用的表达赞同的方式是什么？",
    "你如何拒绝别人的请求？",
    # 思维方式类
    "你通常如何分析一个复杂问题？",
    "你做决定时更依赖直觉还是数据？",
    "你如何激发自己的创造力？",
    "你对风险的态度是什么？",
    "你如何看待规则和灵活性？",
    "你复盘的习惯是什么？",
    "你如何处理信息过载？",
    "你更喜欢深度还是广度？",
    "你如何评价一个想法的好坏？",
    "你最常见的思维误区是什么？",
]


def run_probes(
    persona: dict,
    llm_fn: Callable[[str], str],
    n_probes: int = 20,
) -> dict:
    """
    用探针问题验证和补充人格表示

    1. 让 LLM 基于已有人格数据模拟回答探针问题
    2. 分析回答是否与现有人格陈述一致
    3. 发现新维度或修正矛盾
    """
    logger.info(f"执行主动探针验证 ({n_probes} 个问题)...")

    # 准备人格上下文
    persona_context = _format_persona_context(persona)
    probes_to_use = PROBE_QUESTIONS[:n_probes]

    probe_results = []
    for i, question in enumerate(probes_to_use):
        logger.info(f"  探针 [{i+1}/{n_probes}]: {question[:30]}...")

        # 1. 让 LLM 模拟目标人物回答
        simulate_prompt = f"""根据以下人格描述，以该人物的身份和风格回答问题。

人格描述：
{persona_context}

问题：{question}

请以该人物的口吻直接回答（100-200字），不要解释你在模拟："""

        try:
            simulated_answer = llm_fn(simulate_prompt)
        except Exception as e:
            logger.warning(f"  探针 {i+1} 模拟回答失败: {e}")
            continue

        # 2. 分析回答的一致性
        verify_prompt = f"""分析以下模拟回答是否与人格描述一致。

人格描述：
{persona_context}

问题：{question}
模拟回答：{simulated_answer}

请用 JSON 格式输出：
{{
  "consistency_score": 0.85,
  "new_insights": ["从回答中发现的新人格特征（如有）"],
  "conflicts": ["与现有描述矛盾的地方（如有）"]
}}"""

        try:
            analysis = llm_fn(verify_prompt)
            result = _parse_json(analysis)
            result["question"] = question
            result["answer"] = simulated_answer
            probe_results.append(result)
        except Exception as e:
            logger.warning(f"  探针 {i+1} 分析失败: {e}")

    # 3. 汇总探针结果，补充人格
    persona = _integrate_probe_results(persona, probe_results)

    avg_consistency = 0.0
    if probe_results:
        scores = [r.get("consistency_score", 0.5) for r in probe_results]
        avg_consistency = sum(scores) / len(scores)
    logger.info(f"探针验证完成: 平均一致性 {avg_consistency:.2f}")

    persona["probe_consistency"] = avg_consistency
    persona["probe_results_count"] = len(probe_results)
    return persona


def _format_persona_context(persona: dict) -> str:
    """将人格 JSON 格式化为可读文本"""
    lines = []
    for dim in persona.get("dimensions", []):
        name = dim.get("dimension", "未知")
        statements = dim.get("statements", [])
        if statements:
            lines.append(f"【{name}】")
            for s in statements:
                lines.append(f"  - {s}")
    return "\n".join(lines) if lines else "（暂无详细人格描述）"


def _integrate_probe_results(persona: dict, probe_results: list[dict]) -> dict:
    """将探针发现整合入人格表示"""
    new_insights: list[str] = []
    conflicts: list[str] = []

    for result in probe_results:
        new_insights.extend(result.get("new_insights", []))
        conflicts.extend(result.get("conflicts", []))

    # 去重
    new_insights = list(set(i for i in new_insights if i))
    conflicts = list(set(c for c in conflicts if c))

    if new_insights:
        persona.setdefault("probe_insights", []).extend(new_insights)
        logger.info(f"  发现 {len(new_insights)} 条新特征")

    if conflicts:
        persona.setdefault("probe_conflicts", []).extend(conflicts)
        logger.warning(f"  发现 {len(conflicts)} 条矛盾")

    return persona


def _parse_json(text: str) -> dict:
    """从回复中提取 JSON"""
    import re
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return {}
