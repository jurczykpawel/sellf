from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]


class WorkflowContractTests(unittest.TestCase):
    def test_workflow_boundaries(self):
        workflow = (ROOT / ".github/workflows/release-gate.yml").read_text()
        self.assertRegex(workflow, r"\non:\n  workflow_dispatch:")
        self.assertNotRegex(workflow, r"(?m)^  (pull_request\w*|push|schedule|workflow_call):")
        self.assertRegex(workflow, r"\npermissions:\n  contents: read\n")
        self.assertEqual(workflow.count("permissions:"), 1)
        jobs = dict(re.findall(r"(?ms)^  ([\w-]+):\n(.*?)(?=^  [\w-]+:\n|\Z)", workflow.split("\njobs:\n")[1]))
        self.assertEqual([name for name, job in jobs.items() if "secrets." in job], ["stripe"])
        self.assertEqual(
            set(re.findall(r"secrets\.(\w+)", workflow)),
            {
                "STRIPE_SANDBOX_SECRET_KEY",
                "STRIPE_SANDBOX_PUBLISHABLE_KEY",
                "STRIPE_SANDBOX_ACCOUNT_ID",
            },
        )
        self.assertNotIn("vars.STRIPE_SANDBOX_", workflow)
        self.assertEqual([name for name, job in jobs.items() if "environment:" in job], ["stripe"])
        self.assertIn("environment: release-gate", jobs["stripe"])
        self.assertRegex(jobs["stripe"], r"\n    strategy:\n(?:      [^\n]+\n)*      max-parallel: 2\n")
        self.assertEqual(workflow.count("oven-sh/setup-bun@"), workflow.count("no-cache: true"))
        for action in re.findall(r"(?m)^\s*(?:- )?uses: (.+)$", workflow):
            self.assertRegex(action, r"^[\w/-]+@[a-f0-9]{40} # v\d")
        self.assertEqual(workflow.count("actions/checkout@"), workflow.count("persist-credentials: false"))
        self.assertNotRegex(workflow, r"(?m)^\s*(?:printenv|env\s*$|set -x)")
        self.assertIn('run: python3 -B gate/scripts/release-gate/validate_receipt.py', workflow)
        self.assertRegex(jobs["inventory"], r"(?m)^      - &validate-receipt\n(?s:.*?)^      - name: Upload")
        self.assertRegex(jobs["checks"], r"\n      - \*validate-receipt\n      - &lane-failure\n")
        self.assertRegex(jobs["stripe"], r"\n      - \*validate-receipt\n      - \*lane-failure\n")
        self.assertRegex(jobs["gate-result"], r"\n      - \*validate-receipt\n      - name: Upload")
        self.assertEqual(
            workflow.count("upload-artifact@"),
            workflow.count("if: failure() && steps.receipt.outcome == 'success'"),
        )
        self.assertEqual(workflow.count("upload-artifact@"), workflow.count("retention-days: 3"))


if __name__ == "__main__":
    unittest.main()
