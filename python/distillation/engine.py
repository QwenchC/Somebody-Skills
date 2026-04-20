"""
SBS 蒸馏引擎 — 双轨蒸馏总调度
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from .llm_client import LLMClient
from .embedder import embed_texts, build_vector_store
from .clusterer import cluster_embeddings, summarize_clusters
from .extractor import extract_track, merge_tracks
from .prober import run_probes
from .debater import debate_tracks

logger = logging.getLogger("sbs.distillation")


class _NumpyEncoder(json.JSONEncoder):
    """处理 numpy 类型的 JSON 序列化"""
    def default(self, obj):
        import numpy as np
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


def _save_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, cls=_NumpyEncoder), encoding="utf-8")


class DistillationEngine:
    """双轨蒸馏引擎：工作技能轨 + 人格特征轨"""

    def __init__(self, workspace: str, llm_base_url: str = "http://127.0.0.1:8000", embedding_model: str = "all-MiniLM-L6-v2", target_name: str = ""):
        self.workspace = Path(workspace)
        self.raw_dir = self.workspace / "raw"
        self.processed_dir = self.workspace / "processed"
        self.output_dir = self.workspace / "output"
        self.vectordb_dir = self.workspace / "vectordb"
        self.llm_base_url = llm_base_url
        self.embedding_model = embedding_model
        self.target_name = target_name
        self.llm = LLMClient(llm_base_url)

        for d in [self.processed_dir, self.output_dir, self.vectordb_dir]:
            d.mkdir(parents=True, exist_ok=True)

    def run(self, single_track: bool = False, skip_probes: bool = False) -> dict:
        """执行完整蒸馏流程"""

        # 1. 加载并分块
        logger.info("步骤 1/6: 加载与分块...")
        chunks = self._load_and_chunk()
        logger.info(f"  共 {len(chunks)} 个分块")

        if not chunks:
            raise RuntimeError("没有找到可蒸馏的数据，请先运行 sbs collect")

        # 2. 向量化
        logger.info("步骤 2/6: 向量化...")
        logger.info(f"  Embedding 模型: {self.embedding_model}")
        texts = [c["text"] for c in chunks]
        embeddings = embed_texts(texts, model_name=self.embedding_model)
        collection = build_vector_store(
            chunks,
            persist_dir=str(self.vectordb_dir),
        )

        # 3. 聚类
        logger.info("步骤 3/6: 主题聚类...")
        min_cluster = max(3, len(chunks) // 20)
        clusters = cluster_embeddings(embeddings, texts, min_cluster_size=min_cluster)
        clusters = summarize_clusters(clusters, self.llm.chat)

        # 保存中间结果
        clusters_file = self.output_dir / "clusters.json"
        _save_json(clusters_file, [
            {k: v for k, v in c.items() if k != "centroid"}
            for c in clusters
        ])

        # 4. 人格提取
        logger.info("步骤 4/6: 人格原语提取 (轨道 A: 工作技能)...")
        track_a = extract_track(clusters, track="work", llm_fn=self.llm.chat)

        if single_track:
            persona = {"dimensions": track_a.get("dimensions", []), "work_track": track_a}
        else:
            logger.info("步骤 4/6: 人格原语提取 (轨道 B: 人格特征)...")
            track_b = extract_track(clusters, track="personality", llm_fn=self.llm.chat)

            # 5. 辩论
            logger.info("步骤 5/6: 双轨辩论与交叉验证...")
            persona = debate_tracks(track_a, track_b, self.llm.chat)

        # 6. 探针验证
        if not skip_probes:
            logger.info("步骤 6/6: 主动探针验证...")
            persona = run_probes(persona, self.llm.chat, n_probes=20)
        else:
            logger.info("步骤 6/6: 跳过探针验证")

        # 冲突检测
        persona = self._resolve_conflicts(persona)

        # 生成最终 persona.json
        if self.target_name:
            persona["target_name"] = self.target_name
        persona["meta"] = {
            "total_chunks": len(chunks),
            "total_clusters": len(clusters),
            "single_track": single_track,
            "skip_probes": skip_probes,
        }

        output_path = self.output_dir / "persona.json"
        _save_json(output_path, persona)
        logger.info(f"蒸馏完成！输出: {output_path}")
        logger.info(f"  维度数量: {len(persona.get('dimensions', []))}")
        return persona

    def _load_and_chunk(self) -> list[dict]:
        """加载 raw/ 和 processed/ 目录的所有文本，分块"""
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from preprocessor.pipeline import sanitize_text, chunk_text

        chunks: list[dict] = []
        chunk_id = 0

        # 优先从 processed/ 读取
        for f in sorted(self.processed_dir.rglob("*.txt")):
            text = f.read_text(encoding="utf-8", errors="replace").strip()
            if len(text) < 20:
                continue
            chunks.append({
                "id": f"chunk_{chunk_id:06d}",
                "text": text,
                "source": str(f.relative_to(self.workspace)),
                "metadata": {"file": f.name},
            })
            chunk_id += 1

        # 如果没有预处理结果，从 raw/ 直接读取并分块
        if not chunks:
            logger.info("  未找到预处理数据，从 raw/ 直接加载...")
            for f in sorted(self.raw_dir.rglob("*")):
                if not f.is_file():
                    continue
                try:
                    if f.suffix.lower() == ".json":
                        raw = json.loads(f.read_text(encoding="utf-8", errors="replace"))
                        text = raw.get("content", "") if isinstance(raw, dict) else str(raw)
                    else:
                        text = f.read_text(encoding="utf-8", errors="replace")
                except Exception:
                    continue

                cleaned = sanitize_text(text)
                if len(cleaned) < 20:
                    continue

                for segment in chunk_text(cleaned):
                    chunks.append({
                        "id": f"chunk_{chunk_id:06d}",
                        "text": segment,
                        "source": str(f.relative_to(self.workspace)),
                        "metadata": {"file": f.name},
                    })
                    chunk_id += 1

        return chunks

    def _resolve_conflicts(self, persona: dict) -> dict:
        """检测维度间的矛盾并尝试解决"""
        dims = persona.get("dimensions", [])
        if len(dims) < 2:
            return persona

        all_statements: list[tuple[str, str]] = []
        for dim in dims:
            for stmt in dim.get("statements", []):
                all_statements.append((dim.get("dimension", ""), stmt))

        if len(all_statements) < 4:
            return persona

        stmt_text = "\n".join(
            f"[{dim}] {stmt}" for dim, stmt in all_statements[:40]
        )

        prompt = f"""以下是关于同一人物的多条人格陈述。请找出其中相互矛盾的陈述对（如果存在）。

{stmt_text}

如果没有发现矛盾，返回空数组。
请用 JSON 格式输出：
[{{"statement_a": "...", "statement_b": "...", "conflict": "矛盾点描述", "suggestion": "建议保留哪个或如何调和"}}]"""

        try:
            response = self.llm.chat(prompt)
            m = re.search(r"\[.*\]", response, re.DOTALL)
            if m:
                conflicts = json.loads(m.group(0))
                if conflicts:
                    persona["detected_conflicts"] = conflicts
                    logger.info(f"  发现 {len(conflicts)} 个潜在矛盾")
        except Exception as e:
            logger.warning(f"  冲突检测失败: {e}")

        return persona

    def _probe(self, persona: dict) -> dict:
        """200 探针问题主动验证"""
        # TODO: Phase 4 实现
        raise NotImplementedError
