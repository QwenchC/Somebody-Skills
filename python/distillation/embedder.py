"""
SBS Embedding Pipeline
使用 sentence-transformers 将文本分块向量化，存入 ChromaDB
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger("sbs.embedder")

# 全局模型缓存
_model = None


def get_model(model_name: str = "all-MiniLM-L6-v2"):
    global _model
    if _model is None:
        import torch
        from sentence_transformers import SentenceTransformer

        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"加载 Embedding 模型: {model_name} (device={device})")
        _model = SentenceTransformer(model_name, device=device)
        logger.info("Embedding 模型加载完成")
    return _model


def embed_texts(
    texts: list[str],
    model_name: str = "all-MiniLM-L6-v2",
    batch_size: int = 64,
) -> np.ndarray:
    """将文本列表批量向量化"""
    model = get_model(model_name)
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=True,
        normalize_embeddings=True,
    )
    return embeddings


def build_vector_store(
    chunks: list[dict],
    collection_name: str = "sbs_persona",
    persist_dir: str = "./workspace/vectordb",
    model_name: str = "BAAI/bge-large-zh-v1.5",
    batch_size: int = 64,
) -> "chromadb.Collection":
    """
    将分块文本向量化并存入 ChromaDB

    chunks: [{"id": str, "text": str, "source": str, "metadata": dict}, ...]
    """
    import chromadb

    logger.info(f"构建向量库: {collection_name} ({len(chunks)} 块)")

    texts = [c["text"] for c in chunks]
    embeddings = embed_texts(texts, model_name=model_name, batch_size=batch_size)

    client = chromadb.PersistentClient(path=persist_dir)

    # 删除已有同名集合后重建
    try:
        client.delete_collection(collection_name)
    except Exception:
        pass

    collection = client.create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )

    # 分批添加（ChromaDB 限制每批大小）
    BATCH = 500
    for i in range(0, len(chunks), BATCH):
        batch_chunks = chunks[i : i + BATCH]
        batch_embeds = embeddings[i : i + BATCH].tolist()
        collection.add(
            ids=[c["id"] for c in batch_chunks],
            embeddings=batch_embeds,
            documents=[c["text"] for c in batch_chunks],
            metadatas=[c.get("metadata", {}) for c in batch_chunks],
        )

    logger.info(f"向量库构建完成: {collection.count()} 条记录")
    return collection


def query_similar(
    query: str,
    collection_name: str = "sbs_persona",
    persist_dir: str = "./workspace/vectordb",
    n_results: int = 10,
    model_name: str = "BAAI/bge-large-zh-v1.5",
) -> list[dict]:
    """查询相似文本"""
    import chromadb

    embedding = embed_texts([query], model_name=model_name)[0].tolist()

    client = chromadb.PersistentClient(path=persist_dir)
    collection = client.get_collection(collection_name)

    results = collection.query(
        query_embeddings=[embedding],
        n_results=n_results,
    )

    items = []
    for i in range(len(results["ids"][0])):
        items.append({
            "id": results["ids"][0][i],
            "text": results["documents"][0][i],
            "distance": results["distances"][0][i] if results.get("distances") else None,
            "metadata": results["metadatas"][0][i] if results.get("metadatas") else {},
        })
    return items
