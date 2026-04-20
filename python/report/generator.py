"""
SBS 人格报告生成器
生成 persona_report.html 可视化展示蒸馏结果
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger("sbs.report")

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SBS 人格蒸馏报告 — {{name}}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; }
  .container { max-width: 960px; margin: 0 auto; padding: 2rem; }
  h1 { color: #1a1a2e; margin-bottom: 0.5rem; }
  .subtitle { color: #666; margin-bottom: 2rem; }
  .meta { background: #fff; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; }
  .meta-item { text-align: center; }
  .meta-item .value { font-size: 2rem; font-weight: bold; color: #4361ee; }
  .meta-item .label { font-size: 0.85rem; color: #888; }
  .dimension { background: #fff; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .dimension h3 { color: #4361ee; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
  .confidence { font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; background: #e8f0fe; color: #4361ee; }
  .statements { list-style: none; }
  .statements li { padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0; }
  .statements li:last-child { border-bottom: none; }
  .evidence { margin-top: 0.5rem; padding: 0.75rem; background: #fffbeb; border-left: 3px solid #fbbf24; border-radius: 4px; font-size: 0.85rem; color: #666; }
  .consensus { background: #f0fdf4; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
  .consensus h3 { color: #16a34a; }
  .conflicts { background: #fef2f2; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
  .conflicts h3 { color: #dc2626; }
  .footer { text-align: center; color: #999; padding: 2rem 0; font-size: 0.85rem; }
</style>
</head>
<body>
<div class="container">
  <h1>🧠 {{name}}</h1>
  <p class="subtitle">SBS 人格蒸馏报告</p>

  <div class="meta">
    <div class="meta-grid">
      <div class="meta-item">
        <div class="value">{{n_dimensions}}</div>
        <div class="label">人格维度</div>
      </div>
      <div class="meta-item">
        <div class="value">{{n_chunks}}</div>
        <div class="label">数据分块</div>
      </div>
      <div class="meta-item">
        <div class="value">{{n_clusters}}</div>
        <div class="label">主题聚类</div>
      </div>
      <div class="meta-item">
        <div class="value">{{consistency}}</div>
        <div class="label">探针一致性</div>
      </div>
    </div>
  </div>

  {{dimensions_html}}

  {{consensus_html}}

  {{conflicts_html}}

  <div class="footer">
    由 SBS (Somebody-Skills) v0.1.0 生成 · {{date}}
  </div>
</div>
</body>
</html>"""


def generate_report(persona_path: str, output_path: str) -> str:
    """从 persona.json 生成 HTML 报告"""
    persona = json.loads(Path(persona_path).read_text(encoding="utf-8"))

    name = persona.get("target_name", "somebody")
    meta = persona.get("meta", {})
    dims = persona.get("dimensions", [])

    # 渲染维度
    dims_html = []
    for dim in dims:
        confidence = dim.get("confidence", 0)
        conf_pct = f"{confidence * 100:.0f}%" if confidence else "N/A"
        statements = dim.get("statements", [])
        evidence = dim.get("evidence_snippets", [])

        stmts_li = "".join(f"<li>{s}</li>" for s in statements)
        evidence_html = ""
        if evidence:
            evidence_html = '<div class="evidence"><strong>证据片段:</strong><br>' + "<br>".join(f"「{e}」" for e in evidence[:3]) + "</div>"

        dims_html.append(f"""
  <div class="dimension">
    <h3>{dim.get('dimension', '未知')} <span class="confidence">{conf_pct}</span></h3>
    <ul class="statements">{stmts_li}</ul>
    {evidence_html}
  </div>""")

    # 共识
    consensus = persona.get("consensus", [])
    consensus_html = ""
    if consensus:
        items = "".join(f"<li>{c}</li>" for c in consensus)
        consensus_html = f'<div class="consensus"><h3>✅ 双轨共识</h3><ul class="statements">{items}</ul></div>'

    # 冲突
    conflicts = persona.get("detected_conflicts", [])
    conflicts_html = ""
    if conflicts:
        items = "".join(
            f'<li><strong>{c.get("conflict", "")}</strong>: {c.get("suggestion", "")}</li>'
            for c in conflicts
        )
        conflicts_html = f'<div class="conflicts"><h3>⚠️ 检测到的矛盾</h3><ul class="statements">{items}</ul></div>'

    from datetime import date
    html = HTML_TEMPLATE.replace("{{name}}", name)
    html = html.replace("{{n_dimensions}}", str(len(dims)))
    html = html.replace("{{n_chunks}}", str(meta.get("total_chunks", "?")))
    html = html.replace("{{n_clusters}}", str(meta.get("total_clusters", "?")))
    html = html.replace("{{consistency}}", f"{persona.get('probe_consistency', 0):.0%}")
    html = html.replace("{{dimensions_html}}", "\n".join(dims_html))
    html = html.replace("{{consensus_html}}", consensus_html)
    html = html.replace("{{conflicts_html}}", conflicts_html)
    html = html.replace("{{date}}", str(date.today()))

    out = Path(output_path)
    out.write_text(html, encoding="utf-8")
    logger.info(f"报告生成: {out}")
    return str(out)
