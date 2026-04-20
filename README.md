# Somebody-Skills (SBS)

将任意目标人物的数字痕迹转化为可部署的 `.skill` 文件。

> 本地化运行，无需联网，充分利用本地 GPU 进行嵌入向量化与 LLM 蒸馏推理。

---

## 功能特性

- **一键采集**：从 GitHub 等平台自动爬取目标人物的公开内容，或加载本地文本/PDF/JSON 文件
- **双轨蒸馏**：工作技能轨 × 人格特征轨并行提取，LLM 驱动的主题聚类 + 维度分析
- **实时进度**：蒸馏过程逐步骤、逐维度输出进度，包含 LLM 耗时与置信度
- **按目标命名**：采集时自动记录目标名称，pack 生成的文件为 `gvanrossum.skill` 而非通用名
- **一键封装**：渲染 Handlebars 模板生成 `SKILL.md`，可选输出 `.zip` 压缩包
- **全本地**：支持 LM Studio / llama.cpp 等 OpenAI 兼容接口，不依赖任何云 API

---

## 环境要求

| 组件 | 版本 |
|------|------|
| Node.js | ≥ 18 |
| Python | ≥ 3.10 |
| LM Studio 或兼容 API | 监听 `http://localhost:1234` |
| GPU（可选） | CUDA 12.x，用于 embedding 加速 |

推荐模型：`Qwen3.5-35B-A3B-Q4_K_M`（在 LM Studio 中加载）

---

## 快速开始

### 1. 安装依赖

```bash
# Node 依赖
npm install

# 编译 TypeScript
npm run build

# Python 虚拟环境
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux

pip install fastapi uvicorn sentence-transformers chromadb hdbscan \
            beautifulsoup4 jinja2 tiktoken torch torchvision torchaudio \
            --index-url https://download.pytorch.org/whl/cu128
```

### 2. 配置

```bash
# 初始化配置（生成 ~/.sbs/config.json）
node dist/cli/index.js setup
```

或手动编辑 `~/.sbs/config.json`：

```json
{
  "llmBaseUrl": "http://localhost:1234",
  "llmModel": "Qwen3.5-35B-A3B-Q4_K_M",
  "embeddingModel": "all-MiniLM-L6-v2",
  "pythonPath": ".venv/Scripts/python.exe"
}
```

### 3. 运行完整流水线

```bash
# Step 1：采集目标人物数据（以 gvanrossum 为例）
node dist/cli/index.js collect -t gvanrossum -p github

# Step 2：蒸馏（约 20-30 分钟，实时输出每个维度进度）
node dist/cli/index.js distill --single-track --skip-probes

# Step 3：封装为 .skill 文件
node dist/cli/index.js pack --zip
```

输出位于 `workspace/output/gvanrossum.skill/`。

---

## CLI 命令参考

```
sbs collect  -t <name> -p <platform>   采集目标人物数据
sbs distill  [--single-track] [--skip-probes]  执行蒸馏
sbs pack     [-o <path>] [--zip]        封装 .skill 文件
sbs install  <skillPath>                安装到 AI 工具 skills/ 目录
sbs check                               环境健康检查
sbs setup                               自动配置运行环境
```

---

## 项目结构

```
Somebody-Skills/
├── src/                    # TypeScript 源码
│   ├── cli/                # CLI 命令实现
│   ├── data-collector/     # 爬虫插件（GitHub、通用网页、本地文件）
│   ├── packager/           # .skill 封装器
│   └── utils/              # 配置、日志、Python 桥接
├── python/                 # Python 蒸馏引擎
│   ├── distillation/       # 核心蒸馏模块
│   │   ├── engine.py       # 总调度
│   │   ├── embedder.py     # sentence-transformers 向量化
│   │   ├── clusterer.py    # HDBSCAN 主题聚类
│   │   ├── extractor.py    # LLM 人格维度提取
│   │   └── llm_client.py   # OpenAI 兼容 HTTP 客户端
│   └── preprocessor/       # 文本清洗与分块
├── templates/
│   └── skill.md.hbs        # SKILL.md Handlebars 模板
├── demo_data/              # 示例本地数据
└── workspace/              # 运行时工作区（gitignore）
    ├── raw/                # 采集的原始数据
    ├── processed/          # 预处理后数据
    └── output/             # 蒸馏结果 + .skill 文件
```

---

## 蒸馏流程

```
采集原始数据
    │
    ▼
预处理（清洗 / 分块）
    │
    ▼
向量化（sentence-transformers + CUDA）
    │
    ▼
主题聚类（HDBSCAN）→ LLM 生成聚类标签
    │
    ▼
人格维度提取（10 个维度，逐一 LLM 推理）
    │
    ▼
冲突检测（跨维度一致性校验）
    │
    ▼
输出 persona.json → 渲染 SKILL.md → 打包
```

---

## 注意事项

- 采集时请遵守目标平台的 `robots.txt` 及相关法律法规
- 本项目仅供学习研究，请勿用于伪造他人身份或其他违规用途
- 蒸馏质量取决于采集数据量与 LLM 能力，数据越丰富结果越准确

---

## License

MIT
