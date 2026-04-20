"""
SBS Python 蒸馏引擎入口点
供 Node.js 通过 subprocess 调用：
  python -m sbs_engine <command> [args...]
"""

import argparse
import json
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stderr,  # 确保日志不污染 stdout（JSON 输出通道）
)
logger = logging.getLogger("sbs")


def cmd_preprocess(args: argparse.Namespace) -> None:
    from preprocessor.pipeline import process_directory

    stats = process_directory(args.input, args.output, mask_pii=not args.no_mask)
    print(json.dumps(stats, ensure_ascii=False))


def cmd_distill(args: argparse.Namespace) -> None:
    from distillation.engine import DistillationEngine

    engine = DistillationEngine(
        workspace=args.workspace,
        llm_base_url=args.llm_url,
        embedding_model=args.embedding_model,
        target_name=args.target or "",
    )
    persona = engine.run(
        single_track=args.single_track,
        skip_probes=args.skip_probes,
    )
    print(json.dumps({"status": "ok", "dimensions": len(persona.get("dimensions", []))}, ensure_ascii=False))


def cmd_report(args: argparse.Namespace) -> None:
    from report.generator import generate_report

    output = generate_report(args.persona, args.output)
    print(json.dumps({"status": "ok", "path": output}, ensure_ascii=False))


def cmd_chat(args: argparse.Namespace) -> None:
    """简易 TUI 对话"""
    persona = json.loads(Path(args.persona).read_text(encoding="utf-8"))
    from distillation.llm_client import LLMClient

    client = LLMClient(args.llm_url)

    # 构建系统 prompt
    dims = persona.get("dimensions", [])
    persona_desc = []
    for d in dims:
        stmts = d.get("statements", [])
        if stmts:
            persona_desc.append(f"【{d.get('dimension', '')}】: " + "; ".join(stmts))
    system_prompt = (
        "你是一个人物的数字分身，请以该人物的风格回答问题。\n\n"
        "人格描述：\n" + "\n".join(persona_desc)
    )

    if args.mode == "web":
        print("Gradio Web UI 暂未集成，请使用 TUI 模式")
        return

    print("\n=== SBS 测试对话 (输入 quit 退出) ===\n")
    while True:
        try:
            user_input = input("你: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not user_input or user_input.lower() in ("quit", "exit"):
            break
        try:
            response = client.chat(user_input, system=system_prompt)
            print(f"AI: {response}\n")
        except Exception as e:
            print(f"[错误] {e}\n")


def main() -> None:
    parser = argparse.ArgumentParser(prog="sbs_engine", description="SBS Python Engine")
    sub = parser.add_subparsers(dest="command")

    # preprocess
    p_pre = sub.add_parser("preprocess", help="预处理原始数据")
    p_pre.add_argument("--input", required=True, help="原始数据目录")
    p_pre.add_argument("--output", required=True, help="处理后数据输出目录")
    p_pre.add_argument("--no-mask", action="store_true", help="不脱敏")

    # distill
    p_dist = sub.add_parser("distill", help="执行蒸馏")
    p_dist.add_argument("--workspace", required=True, help="工作区根目录")
    p_dist.add_argument("--llm-url", default="http://127.0.0.1:8000", help="LLM 服务地址")
    p_dist.add_argument("--embedding-model", default="all-MiniLM-L6-v2", help="Embedding 模型名")
    p_dist.add_argument("--target", default="", help="目标人物名称（写入 persona.json）")
    p_dist.add_argument("--single-track", action="store_true", help="单轨蒸馏")
    p_dist.add_argument("--skip-probes", action="store_true", help="跳过探针")

    # report
    p_report = sub.add_parser("report", help="生成 HTML 报告")
    p_report.add_argument("--persona", required=True, help="persona.json 路径")
    p_report.add_argument("--output", required=True, help="输出 HTML 路径")

    # chat
    p_chat = sub.add_parser("chat", help="测试对话")
    p_chat.add_argument("--persona", required=True, help="persona.json 路径")
    p_chat.add_argument("--llm-url", default="http://127.0.0.1:8000", help="LLM 服务地址")
    p_chat.add_argument("--mode", default="tui", choices=["tui", "web"])

    args = parser.parse_args()

    if args.command == "preprocess":
        cmd_preprocess(args)
    elif args.command == "distill":
        cmd_distill(args)
    elif args.command == "report":
        cmd_report(args)
    elif args.command == "chat":
        cmd_chat(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
