"""Local workflow evidence validator. No model, network or command execution."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

DEFINITION = Path(__file__).resolve().parents[1] / 'workflow.json'
IGNORED = {'.git', 'node_modules', '__pycache__'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    if path.is_file():
        return hashlib.sha256(path.read_bytes()).hexdigest()
    if path.is_dir():
        # Track membership as well as content: new/deleted source files invalidate reviews.
        entries = []
        for item in sorted(path.rglob('*')):
            relative = item.relative_to(path)
            if any(part in IGNORED for part in relative.parts):
                continue
            if item.is_symlink():
                raise ValueError('Input directories must not contain symlinks: ' + str(item))
            if item.is_file():
                entries.append([relative.as_posix(), digest(item)])
        return hashlib.sha256(json.dumps(entries, ensure_ascii=False).encode('utf-8')).hexdigest()
    raise ValueError('Missing evidence/input: ' + str(path))


def fingerprint(root, value):
    path = Path(value)
    return {'path': path.as_posix(), 'sha256': digest(root / path)}


def current(root, evidence):
    if not isinstance(evidence, dict) or not isinstance(evidence.get('path'), str):
        return False
    try:
        return bool(evidence['path']) and digest(root / evidence['path']) == evidence.get('sha256')
    except (OSError, ValueError):
        return False


def validate_state(state, definition):
    if not isinstance(state, dict) or state.get('schema_version') != 1:
        raise ValueError('Unsupported workflow state schema')
    if state.get('workflow_version') != definition['version']:
        raise ValueError('Workflow version changed; verify existing evidence before migration')
    if not isinstance(state.get('scope'), str) or not state['scope'].strip():
        raise ValueError('A non-empty iteration/change scope is required')
    if state.get('design_type') not in ('overview', 'overall', 'micro'):
        raise ValueError('design_type must be overview/overall/micro')
    if not isinstance(state.get('gates'), dict) or not isinstance(state.get('blockers'), list):
        raise ValueError('gates must be an object; blockers must be a list')
    known = {name for g in definition['gates'] for name in [g['id'], *g['aliases']]}
    if set(state['gates']) - known:
        raise ValueError('Unknown gate names; correct them before evaluation')


def gate_result(root, state, gate):
    entries = [state['gates'][key] for key in [gate['id'], *gate['aliases']]
               if key in state['gates']]
    if not entries:
        return 'unknown', False, '缺少记录；先核验已有报告，不默认重跑'
    if any(entry != entries[0] for entry in entries[1:]):
        return 'conflict', False, '新旧状态字段冲突，需核验原报告'
    record = entries[0]
    if not isinstance(record, dict):
        return 'invalid', False, '记录必须为对象'
    result = record.get('result', 'unknown')
    if record.get('scope') != state['scope']:
        return 'stale', False, '审核范围与当前范围不一致'
    if result not in ('passed', 'scope_passed', 'not_applicable'):
        return str(result), False, '尚未通过；按原审核模式补齐或修复'
    if result == 'not_applicable' and (
            not gate.get('optional') or not isinstance(record.get('reason'), str)
            or not record['reason'].strip()):
        return 'invalid', False, '该项不可跳过，或缺少不适用原因'
    if result == 'scope_passed' and not (
            gate.get('scope_result') and state['design_type'] == 'micro'):
        return 'scope_passed', False, '局部通过不能充当全局认证'
    inputs = record.get('inputs')
    if not isinstance(inputs, list) or not inputs or not record.get('reviewed_at'):
        return 'invalid', False, '缺少输入清单或审核日期'
    if not current(root, record.get('report')) or not all(current(root, i) for i in inputs):
        return 'stale', False, '输入或报告已变化/缺失，仅复查受影响项'
    return result, True, '证据与范围有效，可复用'


def evaluate(root, state, definition):
    validate_state(state, definition)
    rows = []
    for gate in definition['gates']:
        status, accepted, reason = gate_result(root, state, gate)
        rows.append(dict(id=gate['id'], label=gate['label'], status=status,
                         accepted=accepted, reason=reason, action=gate.get(
                             'actions_by_type', {}).get(state['design_type'], gate['action'])))
    missing = [g for g in rows if not g['accepted']]
    ready = not missing and not state['blockers']
    return dict(ready=ready, scope=state['scope'], design_type=state['design_type'],
                gates=rows, blockers=state['blockers'], next_action=(
                    'resolve-blockers' if state['blockers'] else
                    missing[0]['action'] if missing else 'baseline-and-code'))


def render(definition):
    lines = ['graph TD']
    previous = None
    for gate in definition['gates']:
        key = gate['id']
        entry = key
        if gate.get('before'):
            entry = key + '_before'
            lines += [f'  {entry}["{gate["before"]}"]', f'  {entry} --> {key}']
        review = gate.get('interface_review')
        if review:
            entry = key + '_interfaces'
            lines += [f'  {entry}{{"{review["question"]}"}}',
                      f'  {entry} -->|否| {key}',
                      f'  {entry} -->|是| {key}_source["{review["source"]}"]',
                      f'  {key}_source --> {key}_flow["{review["flow"]}"]',
                      f'  {key}_flow --> {key}_fields["{review["fields"]}"]',
                      f'  {key}_fields --> {key}_reason{{"{review["decision"]}"}}',
                      f'  {key}_reason -->|否：补证据或修正| {key}_source',
                      f'  {key}_reason -->|是| {key}']
        if gate.get('optional'):
            entry = key + '_applies'
            lines += [f'  {entry}{{"{gate["question"]}"}}',
                      f'  {key}["{gate["label"]}"]',
                      f'  {key}_na["记录不适用原因与证据"]',
                      f'  {entry} -->|是| {key}', f'  {entry} -->|否| {key}_na',
                      f'  {key} --> {key}_join(("继续"))', f'  {key}_na --> {key}_join']
            following = key + '_join'
        else:
            lines.append(f'  {key}["{gate["label"]}"]')
            following = key
            if gate.get('question'):
                following = key + '_ok'
                lines += [f'  {following}{{"{gate["question"]}"}}',
                          f'  {key} --> {following}', f'  {following} -->|否：补齐| {key}']
        if previous:
            connector = '-->|是|' if previous.endswith('_ok') else '-->'
            lines.append(f'  {previous} {connector} {entry}')
        previous = following
    done = definition['completion']
    lines += [f'  {previous} --> ready{{"{done["question"]}"}}',
              f'  ready -->|是| code["{done["ready"]}"]',
              f'  ready -->|否| fix["{done["repair"]}"]', '  fix --> ready']
    change = definition.get('change_review')
    if change:
        lines += [f'  change["{change["trigger"]}"] --> impact{{"{change["question"]}"}}',
                  '  impact -->|是：更新受影响设计和检查| fix',
                  f'  impact -->|否| reuse["{change["reuse"]}"]',
                  '  reuse --> ready']
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'record', 'evaluate', 'diagram'])
    parser.add_argument('project', nargs='?', default='.')
    parser.add_argument('--state', default='.ai/workflow-state.json')
    parser.add_argument('--scope')
    parser.add_argument('--design-type', choices=['overview', 'overall', 'micro'], default='overview')
    parser.add_argument('--gate')
    parser.add_argument('--result', choices=['passed', 'failed', 'blocked', 'scope_passed', 'not_applicable'])
    parser.add_argument('--input', action='append', default=[])
    parser.add_argument('--report')
    parser.add_argument('--reason', default='')
    parser.add_argument('--output')
    args = parser.parse_args()
    definition = read_json(DEFINITION)
    root = Path(args.project).resolve()
    path = root / args.state
    if args.command == 'diagram':
        graph = render(definition)
        if args.output:
            if Path(args.output).suffix == '.md':
                graph = ('# Design Session 工作流\n\n'
                         '> 由 shared/workflow.json 生成。修正规则后重新生成，不手改流程图。\n\n'
                         '```mermaid\n' + graph + '```\n\n'
                         '已通过且输入未变化的检查直接复用；缺失、不适用、过期的判定方式见 '
                         '[流程规则](workflow.md)。check database 即 database-review 的入口，不重复审核。\n')
            Path(args.output).write_text(graph, encoding='utf-8')
        else:
            print(graph, end='')
        return 0
    if args.command == 'init':
        state = dict(schema_version=1, workflow_version=definition['version'], scope=args.scope,
                     design_type=args.design_type, blockers=[], gates={})
        validate_state(state, definition)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('x', encoding='utf-8') as stream:
            json.dump(state, stream, ensure_ascii=False, indent=2)
        print(json.dumps(dict(state=str(path), initialized=True)))
        return 0
    if not path.exists():
        if args.command != 'evaluate':
            raise ValueError('Initialize an explicit scope before recording evidence')
        state = dict(schema_version=1, workflow_version=definition['version'], scope='未登记',
                     design_type='overview', blockers=[], gates={})
    else:
        state = read_json(path)
    validate_state(state, definition)
    if args.command == 'record':
        gate = next((g for g in definition['gates'] if g['id'] == args.gate), None)
        if not gate or not args.result or not args.input or not args.report:
            raise ValueError('record requires canonical --gate, --result, --input and --report')
        if args.scope and args.scope != state['scope']:
            raise ValueError('Do not relabel earlier reviews as a new scope')
        if args.result == 'not_applicable' and (not gate.get('optional') or not args.reason.strip()):
            raise ValueError('Not applicable requires an optional gate and an evidence-based reason')
        if any(alias in state['gates'] for alias in gate['aliases']):
            raise ValueError('Resolve legacy alias evidence before recording a canonical gate')
        state['gates'][args.gate] = dict(
            result=args.result, scope=state['scope'], reviewed_at=datetime.now(timezone.utc).isoformat(),
            inputs=[fingerprint(root, i) for i in args.input], report=fingerprint(root, args.report),
            reason=args.reason)
        # A single coordinator writes state; parallel reviewers return reports only.
        path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(dict(recorded=args.gate)))
        return 0
    result = evaluate(root, state, definition)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['ready'] else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        sys.exit(main())
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps(dict(ready=False, error=str(error)), ensure_ascii=False))
        sys.exit(2)
