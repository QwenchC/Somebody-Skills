"""
SBS 本地 LLM 推理服务
使用 llama-cpp-python 加载量化模型，暴露 OpenAI 兼容 API
"""

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from pydantic import BaseModel

# 模型实例（延迟加载）
_llm = None


def get_llm():
    global _llm
    if _llm is None:
        from llama_cpp import Llama

        model_path = os.environ.get("LLM_MODEL_PATH", "")
        if not model_path:
            raise RuntimeError(
                "LLM_MODEL_PATH 未设置，请在 .env 中指定 GGUF 模型路径"
            )
        n_gpu_layers = int(os.environ.get("N_GPU_LAYERS", "-1"))
        _llm = Llama(
            model_path=model_path,
            n_ctx=8192,
            n_gpu_layers=n_gpu_layers,
            flash_attn=True,
            verbose=False,
        )
    return _llm


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    yield
    global _llm
    if _llm is not None:
        del _llm
        _llm = None


app = FastAPI(title="SBS LLM Service", lifespan=lifespan)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    max_tokens: int = 2048
    temperature: float = 0.7


class ChatResponse(BaseModel):
    content: str
    usage: dict


@app.post("/v1/chat/completions", response_model=ChatResponse)
async def chat(req: ChatRequest):
    llm = get_llm()
    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    result = llm.create_chat_completion(
        messages=messages,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
    )
    choice = result["choices"][0]
    return ChatResponse(
        content=choice["message"]["content"],
        usage=result.get("usage", {}),
    )


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


@app.post("/v1/embeddings", response_model=EmbedResponse)
async def embed(req: EmbedRequest):
    llm = get_llm()
    results = []
    for text in req.texts:
        emb = llm.embed(text)
        results.append(emb)
    return EmbedResponse(embeddings=results)


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _llm is not None}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("LLM_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
