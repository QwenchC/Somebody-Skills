"""
SBS 双轨辩论机制
工作轨与人格轨 LLM 实例互相质疑，达成一致人格表示
"""

from __future__ import annotations

import json
import logging
from typing import Callable

logger = logging.getLogger("sbs.debater")

DEBATE_ROUNDS = 3


def debate_tracks(
    track_a: dict,
    track_b: dict,
    llm_fn: Callable[[str], str],
    rounds: int = DEBATE_ROUNDS,
) -> dict:
    """
    双轨辩论：工作轨 (A) 与人格轨 (B) 互相质疑

    每轮：
    1. A 根据自己的维度质疑 B 的某些陈述
    2. B 反驳或承认，并反向质疑 A
    3. 汇总达成共识
    """
    logger.info(f"开始双轨辩论 ({rounds} 轮)...")

    context_a = _format_track(track_a, "工作技能")
    context_b = _format_track(track_b, "人格特征")

    consensus_points: list[str] = []
    resolved_conflicts: list[dict] = []

    for r in range(1, rounds + 1):
        logger.info(f"  辩论第 {r}/{rounds} 轮")

        # A 质疑 B
        challenge_a_prompt = f"""你代表「工作技能」视角，已掌握以下关于目标人物的工作特征：

{context_a}

另一个分析师从「人格特征」视角得出以下结论：

{context_b}

请指出人格特征分析中与你的工作分析可能矛盾或不一致的 2-3 个点。
用 JSON 数组格式输出：
[{{"point": "矛盾点描述", "your_evidence": "你的证据", "suggestion": "建议如何调和"}}]"""

        try:
            challenges_a = _parse_json_array(llm_fn(challenge_a_prompt))
        except Exception as e:
            logger.warning(f"  A 质疑失败: {e}")
            challenges_a = []

        # B 回应并反质疑
        challenge_b_prompt = f"""你代表「人格特征」视角，已掌握以下关于目标人物的人格分析：

{context_b}

工作技能分析师提出了以下质疑：
{json.dumps(challenges_a, ensure_ascii=False, indent=2)}

请：
1. 对每个质疑进行回应（接受或反驳）
2. 反向提出 2 个对工作分析的质疑

用 JSON 格式输出：
{{
  "responses": [{{"point": "...", "accept": true/false, "reasoning": "..."}}],
  "counter_challenges": [{{"point": "...", "evidence": "..."}}]
}}"""

        try:
            b_response = _parse_json_dict(llm_fn(challenge_b_prompt))
        except Exception as e:
            logger.warning(f"  B 回应失败: {e}")
            b_response = {"responses": [], "counter_challenges": []}

        # 汇总本轮共识
        for resp in b_response.get("responses", []):
            if resp.get("accept"):
                resolved_conflicts.append({
                    "round": r,
                    "point": resp.get("point", ""),
                    "resolution": "accepted",
                    "reasoning": resp.get("reasoning", ""),
                })

        # 生成本轮共识
        consensus_prompt = f"""基于本轮辩论，请总结工作轨和人格轨达成的 3 个共识点。

辩论内容：
- A 的质疑: {json.dumps(challenges_a, ensure_ascii=False)}
- B 的回应: {json.dumps(b_response, ensure_ascii=False)}

用 JSON 数组格式输出共识点：
["共识点1", "共识点2", "共识点3"]"""

        try:
            round_consensus = _parse_json_array(llm_fn(consensus_prompt))
            consensus_points.extend(
                c if isinstance(c, str) else str(c) for c in round_consensus
            )
        except Exception as e:
            logger.warning(f"  共识汇总失败: {e}")

    # 合并最终结果
    merged = _merge_with_consensus(track_a, track_b, consensus_points, resolved_conflicts)
    logger.info(f"辩论完成: {len(consensus_points)} 个共识点, {len(resolved_conflicts)} 个冲突已解决")
    return merged


def _format_track(track: dict, label: str) -> str:
    lines = [f"=== {label}轨分析 ==="]
    for dim in track.get("dimensions", []):
        lines.append(f"\n【{dim.get('dimension', '')}】")
        for s in dim.get("statements", []):
            lines.append(f"  - {s}")
    return "\n".join(lines)


def _merge_with_consensus(
    track_a: dict,
    track_b: dict,
    consensus: list[str],
    resolved: list[dict],
) -> dict:
    """合并双轨结果 + 辩论共识"""
    return {
        "dimensions": track_a.get("dimensions", []) + track_b.get("dimensions", []),
        "consensus": consensus,
        "resolved_conflicts": resolved,
        "work_track": track_a,
        "personality_track": track_b,
    }


def _parse_json_array(text: str) -> list:
    import re
    text = text.strip()
    try:
        result = json.loads(text)
        return result if isinstance(result, list) else [result]
    except Exception:
        pass
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return []


def _parse_json_dict(text: str) -> dict:
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
