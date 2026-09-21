"""
从结构化 JSON 生成工作量评估 XMind 文件（功能点视角）。

用法：python gen_estimate_xmind.py <json_path> <output_path>

JSON Schema:
{
  "title": "迭代2 全量工作量",
  "summary": "后端28.5d + 前端22d + 测试16d = 62.5d",
  "modules": [
    {
      "name": "账单管理",
      "be_total": 10,
      "fe_total": 6,
      "test_total": 4,
      "owner": "用户",
      "items": [
        {
          "id": "BILL-01",
          "title": "账单自动生成",
          "be": 3,
          "fe": 0,
          "notes": "定时任务+聚合+幂等+编号"
        }
      ]
    }
  ],
  "schedule": {
    "phases": [
      {"name": "设计期", "start": "5/14", "end": "5/15", "days": 2, "notes": "概设评审+提前编码"}
    ]
  },
  "risks": [
    {"item": "MSSW接口延期", "probability": "中", "impact": "高", "mitigation": "Mock开发"}
  ],
  "dependencies": [
    {"from": "PM-05", "to": "BILL-05", "reason": "还款依赖repay接口"}
  ]
}
"""
import json
import sys
import os

def main():
    if len(sys.argv) < 3:
        print("Usage: python gen_estimate_xmind.py <json_path> <output_path>")
        sys.exit(1)

    json_path = sys.argv[1]
    output_path = sys.argv[2]

    try:
        import xmind
    except ImportError:
        print("Installing xmind package...")
        os.system(f"{sys.executable} -m pip install xmind -q")
        import xmind

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if os.path.exists(output_path):
        os.remove(output_path)

    workbook = xmind.load(output_path)
    sheet = workbook.getPrimarySheet()
    sheet.setTitle("工作量评估")

    root = sheet.getRootTopic()
    root.setTitle(f"{data['title']}\n{data['summary']}")

    def add(parent, title, notes=None):
        t = parent.addSubTopic()
        t.setTitle(title)
        if notes:
            t.setPlainNotes(notes)
        return t

    # Modules
    for module in data['modules']:
        owner_tag = f"({module['owner']})" if module.get('owner') else ""
        parts = []
        if module.get('be_total'): parts.append(f"BE {module['be_total']}d")
        if module.get('fe_total'): parts.append(f"FE {module['fe_total']}d")
        if module.get('test_total'): parts.append(f"测试 {module['test_total']}d")
        total = module.get('be_total', 0) + module.get('fe_total', 0) + module.get('test_total', 0)

        mod_title = f"{module['name']} {' + '.join(parts)} = {total}d {owner_tag}".strip()
        mod_topic = add(root, mod_title)

        for item in module.get('items', []):
            parts_item = []
            if item.get('be'): parts_item.append(f"BE {item['be']}d")
            if item.get('fe'): parts_item.append(f"FE {item['fe']}d")
            effort = ' + '.join(parts_item) if parts_item else ''
            item_title = f"{item['id']} {item['title']} [{effort}]" if effort else f"{item['id']} {item['title']}"
            add(mod_topic, item_title, item.get('notes'))

    # Dependencies
    if data.get('dependencies'):
        dep_topic = add(root, "⚡ 关键依赖")
        for dep in data['dependencies']:
            add(dep_topic, f"{dep['from']} → {dep['to']}", dep.get('reason'))

    # Risks
    if data.get('risks'):
        risk_topic = add(root, "⚠️ 风险点")
        for risk in data['risks']:
            add(risk_topic,
                f"[{risk['probability']}概率/{risk['impact']}影响] {risk['item']}",
                f"缓解: {risk.get('mitigation', '待定')}")

    # Schedule summary
    if data.get('schedule', {}).get('phases'):
        sched_topic = add(root, "📅 排期概览")
        for phase in data['schedule']['phases']:
            add(sched_topic,
                f"{phase['name']} {phase['start']}-{phase['end']} ({phase['days']}d)",
                phase.get('notes'))

    xmind.save(workbook, output_path)
    print(f"XMind generated: {output_path}")


if __name__ == '__main__':
    main()
