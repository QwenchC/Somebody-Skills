"""
SBS 主题聚类
使用 HDBSCAN 对文本向量进行聚类，识别主要话题
"""

from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger("sbs.clusterer")


def cluster_embeddings(
    embeddings: np.ndarray,
    texts: list[str],
    min_cluster_size: int = 5,
    min_samples: int = 3,
) -> list[dict]:
    """
    对向量进行 HDBSCAN 聚类

    返回: [{"cluster_id": int, "texts": [...], "centroid": [...], "size": int}, ...]
    """
    import hdbscan

    logger.info(f"HDBSCAN 聚类: {len(embeddings)} 向量, min_cluster_size={min_cluster_size}")

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method="eom",
    )
    labels = clusterer.fit_predict(embeddings)

    # 整理聚类结果
    clusters: dict[int, list[int]] = {}
    for idx, label in enumerate(labels):
        if label == -1:
            continue  # 噪声点
        clusters.setdefault(label, []).append(idx)

    result = []
    for cluster_id, indices in sorted(clusters.items()):
        cluster_texts = [texts[i] for i in indices]
        centroid = embeddings[indices].mean(axis=0)
        result.append({
            "cluster_id": cluster_id,
            "texts": cluster_texts,
            "centroid": centroid.tolist(),
            "size": len(indices),
            "indices": indices,
        })

    # 将噪声点归入最近的聚类
    noise_indices = [i for i, l in enumerate(labels) if l == -1]
    if noise_indices and result:
        centroids = np.array([c["centroid"] for c in result])
        for i in noise_indices:
            dists = np.linalg.norm(centroids - embeddings[i], axis=1)
            nearest = int(np.argmin(dists))
            result[nearest]["texts"].append(texts[i])
            result[nearest]["size"] += 1

    logger.info(f"聚类完成: {len(result)} 个主题 (噪声点 {len(noise_indices)} 已归入最近聚类)")
    return result


def _extract_label_json(text: str) -> dict:
    """从 LLM 回复（可能含思考链）中提取包含 label 字段的 JSON 对象"""
    import json
    text = text.strip()
    # 直接解析
    try:
        d = json.loads(text)
        if isinstance(d, dict) and "label" in d:
            return d
    except Exception:
        pass
    # 用括号深度扫描找所有 { } 块，取最后一个含 label 的
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
                d = json.loads(text[start:end])
                if isinstance(d, dict):
                    candidates.append(d)
            except Exception:
                pass
        pos = start + 1
    for d in reversed(candidates):
        if "label" in d:
            return d
    if candidates:
        return candidates[-1]
    return {}


def summarize_clusters(
    clusters: list[dict],
    llm_fn,
    max_samples_per_cluster: int = 10,
) -> list[dict]:
    """
    为每个聚类生成摘要标签

    llm_fn: 接受 prompt 返回 str 的函数
    """
    for cluster in clusters:
        samples = cluster["texts"][:max_samples_per_cluster]
        sample_text = "\n---\n".join(samples)

        prompt = f"""以下是同一话题的多段文本样本。请用一个简洁的标签（5-15个字）概括这个话题，
并用一句话描述该话题的核心内容。

文本样本：
{sample_text}

请用JSON格式回答：
{{"label": "话题标签", "summary": "一句话描述"}}"""

        cid = cluster['cluster_id']
        logger.info(f"  为聚类 {cid} 生成标签 ({cluster['size']} 个文本片段)...")
        try:
            response = llm_fn(prompt)
            import json, re
            # 从响应中查找包含 "label" 的 JSON 对象（支持嵌套、兼容思考模式长文本）
            info = _extract_label_json(response)
            cluster["label"] = info.get("label", f"主题_{cid}")
            cluster["summary"] = info.get("summary", "")
            logger.info(f"  ✓ 聚类 {cid} 标签: {cluster['label']}")
        except Exception as e:
            logger.warning(f"  ✗ 聚类 {cid} 摘要生成失败: {e}")
            cluster["label"] = f"主题_{cid}"
            cluster["summary"] = ""

    return clusters
