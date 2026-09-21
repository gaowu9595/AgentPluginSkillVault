"""Behavioral tests: real files, fingerprints and CLI; no external services."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from workflow_gate import read_json, render

SCRIPT = Path(__file__).with_name('workflow_gate.py')
GATES = ('input_gate', 'clarification_gate', 'spec_gate', 'design_gate', 'template_gate',
         'database_gate', 'security_gate', 'content_gate')


class WorkflowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / '.ai').mkdir()
        self.path = self.root / '.ai/workflow-state.json'
        self.state = dict(schema_version=1, workflow_version=1, scope='iteration-x',
                          design_type='overview', blockers=[], gates={})

    def cli(self, *args):
        p = subprocess.run([sys.executable, str(SCRIPT), *args],
                           capture_output=True, text=True, encoding='utf-8')
        self.assertIn(p.returncode, (0, 1, 2), p.stderr)
        return p.returncode, json.loads(p.stdout)

    def evaluate(self):
        self.path.write_text(json.dumps(self.state), encoding='utf-8')
        return self.cli('evaluate', str(self.root))

    def evidence(self, name):
        p = self.root / name
        p.write_text(name, encoding='utf-8')
        return {'path': name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}

    def complete(self):
        for gate in GATES:
            self.state['gates'][gate] = dict(
                result='passed', scope='iteration-x', reviewed_at='2026-09-18',
                inputs=[self.evidence(gate + '.md')],
                report=self.evidence(gate + '-report.md'))

    def test_missing_state_does_not_trust_context_ready(self):
        (self.root / '.ai/context.md').write_text('design_status=ready')
        code, result = self.cli('evaluate', str(self.root))
        self.assertEqual(code, 1)
        self.assertFalse(result['ready'])
        self.assertEqual(result['gates'][0]['status'], 'unknown')

    def test_complete_current_evidence_is_reusable(self):
        self.complete()
        code, result = self.evaluate()
        self.assertEqual(code, 0)
        self.assertTrue(result['ready'])
        self.assertEqual(result['next_action'], 'baseline-and-code')

    def test_changed_security_input_invalidates_only_security(self):
        self.complete()
        (self.root / 'security_gate.md').write_text('changed')
        code, result = self.evaluate()
        self.assertEqual(code, 1)
        self.assertEqual([g['id'] for g in result['gates'] if not g['accepted']], ['security_gate'])
        self.assertEqual(result['next_action'], 'check security')

    def test_report_changed_or_missing_cannot_remain_passed(self):
        for missing in (False, True):
            with self.subTest(missing=missing):
                self.complete()
                p = self.root / 'template_gate-report.md'
                if missing:
                    p.unlink()
                else:
                    p.write_text('failed')
                self.assertFalse(self.evaluate()[1]['ready'])

    def test_not_applicable_needs_reason_and_current_evidence(self):
        self.complete()
        g = self.state['gates']['database_gate']
        g['result'] = 'not_applicable'
        self.assertFalse(self.evaluate()[1]['ready'])
        g['reason'] = 'Reviewed model, transactions and storage; no persistence change.'
        self.assertTrue(self.evaluate()[1]['ready'])
        g['inputs'] = []
        self.assertFalse(self.evaluate()[1]['ready'])

    def test_mandatory_template_cannot_be_not_applicable(self):
        self.complete()
        self.state['gates']['template_gate'].update(result='not_applicable', reason='small')
        self.assertFalse(self.evaluate()[1]['ready'])

    def test_scope_passed_is_only_valid_for_matching_micro_change(self):
        self.complete()
        self.state['gates']['database_gate']['result'] = 'scope_passed'
        self.assertFalse(self.evaluate()[1]['ready'])
        self.state['design_type'] = 'micro'
        self.assertTrue(self.evaluate()[1]['ready'])
        self.state['scope'] = 'expanded-scope'
        self.assertFalse(self.evaluate()[1]['ready'])

    def test_alias_conflict_does_not_override_failure(self):
        self.complete()
        self.state['gates']['database_review'] = dict(self.state['gates']['database_gate'], result='failed')
        self.assertFalse(self.evaluate()[1]['ready'])
        del self.state['gates']['database_gate']
        self.state['gates']['database_review']['result'] = 'passed'
        self.assertTrue(self.evaluate()[1]['ready'])

    def test_partial_failure_and_blocker_cannot_be_ready(self):
        self.complete()
        for status in ('failed', 'scope_passed', 'blocked', 'pending', 'stale', 'invented'):
            self.state['gates']['content_gate']['result'] = status
            self.assertFalse(self.evaluate()[1]['ready'], status)
        self.complete()
        self.state['blockers'] = ['P1 unresolved interface']
        self.assertFalse(self.evaluate()[1]['ready'])

    def test_scope_change_and_missing_fingerprints_fail_closed(self):
        self.complete()
        del self.state['gates']['spec_gate']['inputs'][0]['sha256']
        self.assertFalse(self.evaluate()[1]['ready'])

    def test_init_does_not_overwrite_and_record_updates_only_one_gate(self):
        code, _ = self.cli('init', str(self.root), '--scope', 'iteration-x')
        self.assertEqual(code, 0)
        original = self.path.read_bytes()
        code, _ = self.cli('init', str(self.root), '--scope', 'another')
        self.assertEqual(code, 2)
        self.assertEqual(original, self.path.read_bytes())
        self.evidence('input.md')
        self.evidence('review.md')
        code, recorded = self.cli('record', str(self.root), '--gate', 'input_gate', '--result', 'passed',
                           '--input', 'input.md', '--report', 'review.md')
        self.assertEqual(code, 0, recorded)
        state = json.loads(self.path.read_text(encoding='utf-8'))
        self.assertEqual(list(state['gates']), ['input_gate'])
        self.assertFalse(self.cli('evaluate', str(self.root))[1]['ready'])

    def test_malformed_state_returns_structured_error(self):
        self.path.write_text('{invalid', encoding='utf-8')
        code, result = self.cli('evaluate', str(self.root))
        self.assertEqual(code, 2)
        self.assertFalse(result['ready'])

    def test_directory_input_detects_added_source_file(self):
        self.cli('init', str(self.root), '--scope', 'iteration-x')
        (self.root / 'model').mkdir()
        (self.root / 'model/a.txt').write_text('a')
        self.evidence('report.md')
        code, _ = self.cli('record', str(self.root), '--gate', 'input_gate', '--result', 'passed',
                           '--input', 'model', '--report', 'report.md')
        self.assertEqual(code, 0)
        self.assertTrue(self.cli('evaluate', str(self.root))[1]['gates'][0]['accepted'])
        (self.root / 'model/b.txt').write_text('b')
        self.assertEqual(self.cli('evaluate', str(self.root))[1]['gates'][0]['status'], 'stale')

    def test_micro_template_routes_to_lightweight_self_check(self):
        self.complete()
        self.state['design_type'] = 'micro'
        del self.state['gates']['template_gate']
        self.assertEqual(self.evaluate()[1]['next_action'], 'write')

    def test_null_reason_does_not_prove_not_applicable(self):
        self.complete()
        self.state['gates']['database_gate'].update(result='not_applicable', reason=None)
        self.assertFalse(self.evaluate()[1]['ready'])

    def test_spec_ready_but_no_design_routes_to_writing_before_checks(self):
        self.complete()
        for gate in GATES[3:]:
            del self.state['gates'][gate]
        self.assertEqual(self.evaluate()[1]['next_action'], 'write')

    def test_committed_diagram_matches_definition(self):
        shared = SCRIPT.parent.parent
        definition = read_json(shared / 'workflow.json')
        document = (shared / 'workflow-flowchart.md').read_text(encoding='utf-8')
        graph = document.split('```mermaid\n', 1)[1].split('```', 1)[0]
        self.assertEqual(graph, render(definition))

    def test_change_review_branches_rejoin_evidence_gate(self):
        definition = read_json(SCRIPT.parent.parent / 'workflow.json')
        definition['change_review']['trigger'] = 'Updated input'
        graph = render(definition)
        self.assertIn('change["Updated input"] --> impact', graph)
        self.assertIn('impact -->|是：更新受影响设计和检查| fix', graph)
        self.assertIn('impact -->|否| reuse', graph)
        self.assertIn('  fix --> ready', graph)
        self.assertIn('  reuse --> ready', graph)
        self.assertNotIn('reuse --> code', graph)

    def test_interface_review_is_conditional_and_precedes_design(self):
        definition = read_json(SCRIPT.parent.parent / 'workflow.json')
        gate = next(g for g in definition['gates'] if g['id'] == 'design_gate')
        gate['interface_review']['fields'] = 'Inspect actual consumers'
        graph = render(definition)
        self.assertIn('design_gate_fields["Inspect actual consumers"]', graph)
        self.assertIn('spec_gate_ok -->|是| design_gate_interfaces', graph)
        self.assertIn('design_gate_interfaces -->|否| design_gate', graph)
        self.assertIn('design_gate_reason -->|否：补证据或修正| design_gate_source', graph)
        self.assertIn('design_gate_reason -->|是| design_gate', graph)
        self.assertIn('design_gate --> template_gate', graph)
        del gate['interface_review']
        self.assertNotIn('design_gate_interfaces', render(definition))


if __name__ == '__main__':
    unittest.main()
