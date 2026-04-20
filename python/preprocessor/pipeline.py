"""
SBS 数据预处理 Pipeline
清洗 → 脱敏 → 分块
"""

from __future__ import annotations

import re
import logging
from pathlib import Path

logger = logging.getLogger("sbs.preprocessor")

# 敏感信息正则
PHONE_RE = re.compile(r"1[3-9]\d{9}")
ID_CARD_RE = re.compile(r"\d{17}[\dXx]")
EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")


def sanitize_text(text: str, mask_pii: bool = True) -> str:
    """清洗并脱敏文本"""
    # 去除 HTML 标签
    from bs4 import BeautifulSoup

    text = BeautifulSoup(text, "html.parser").get_text(separator="\n")

    # 去除连续空行
    text = re.sub(r"\n{3,}", "\n\n", text)

    if mask_pii:
        text = PHONE_RE.sub("1**********", text)
        text = ID_CARD_RE.sub("*" * 18, text)
        text = EMAIL_RE.sub("***@***.***", text)

    return text.strip()


def chunk_text(text: str, max_tokens: int = 2048) -> list[str]:
    """按近似 token 数分块（1 token ≈ 1.5 中文字符）"""
    approx_chars = int(max_tokens * 1.5)
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + approx_chars, len(text))
        # 尝试在段落边界切分
        if end < len(text):
            boundary = text.rfind("\n\n", start, end)
            if boundary > start:
                end = boundary
        chunks.append(text[start:end].strip())
        start = end
    return [c for c in chunks if c]


def process_directory(
    input_dir: str, output_dir: str, mask_pii: bool = True
) -> dict:
    """预处理整个目录"""
    in_path = Path(input_dir)
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    stats = {"files": 0, "chunks": 0, "total_chars": 0}

    for f in in_path.rglob("*"):
        if not f.is_file():
            continue
        if f.suffix.lower() not in (".txt", ".md", ".json", ".csv"):
            continue

        text = f.read_text(encoding="utf-8", errors="replace")
        cleaned = sanitize_text(text, mask_pii=mask_pii)
        chunks = chunk_text(cleaned)

        stats["files"] += 1
        stats["chunks"] += len(chunks)
        stats["total_chars"] += len(cleaned)

        # 写出分块
        stem = f.stem
        for i, chunk in enumerate(chunks):
            chunk_file = out_path / f"{stem}_chunk_{i:04d}.txt"
            chunk_file.write_text(chunk, encoding="utf-8")

    logger.info(
        f"预处理完成: {stats['files']} 文件, {stats['chunks']} 块, "
        f"{stats['total_chars']} 字符"
    )
    return stats
