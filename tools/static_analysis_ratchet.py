#!/usr/bin/env python3
"""Gate static-analysis reports against the checked-in issue budget."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASELINE = ROOT / "ci" / "static_analysis_baseline.json"
IGNORED_SARIF_RULE_IDS = {
    # Version freshness is tracked by Dependabot/dependency review. Keep these
    # visible in Lint's SARIF/HTML artifacts, but out of the defect ratchet.
    "GradleDependency",
    "NewerVersionAvailable",
    "AndroidGradlePluginVersion",
}


def count_sarif(path: Path) -> tuple[int, int]:
    if not path.exists():
        raise SystemExit(f"SARIF report not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    critical = 0
    noncritical = 0
    for run in data.get("runs", []):
        rules = {
            rule.get("id", ""): rule
            for rule in run.get("tool", {}).get("driver", {}).get("rules", [])
        }
        for result in run.get("results", []):
            level = result.get("level", "warning")
            rule_id = result.get("ruleId", "")
            if rule_id in IGNORED_SARIF_RULE_IDS:
                continue
            tags = rules.get(rule_id, {}).get("properties", {}).get("tags", [])
            if level == "error" or "security" in tags:
                critical += 1
            elif level in {"warning", "note"}:
                noncritical += 1
    return critical, noncritical


def count_clang_tidy(path: Path) -> tuple[int, int]:
    if not path.exists():
        raise SystemExit(f"clang-tidy log not found: {path}")
    critical = 0
    noncritical = 0
    line_re = re.compile(r":\d+:\d+: (warning|error): .*(\[[^\]]+\])")
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "/_deps/" in line:
            continue
        match = line_re.search(line)
        if not match:
            continue
        severity = match.group(1)
        check = match.group(2)
        if severity == "error" or any(tag in check for tag in ("bugprone-", "concurrency-", "security")):
            critical += 1
        else:
            noncritical += 1
    return critical, noncritical


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--sarif", action="append", type=Path, default=[])
    parser.add_argument("--clang-tidy-log", action="append", type=Path, default=[])
    args = parser.parse_args()

    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    critical = 0
    noncritical = 0
    for sarif in args.sarif:
        c, n = count_sarif(sarif)
        critical += c
        noncritical += n
    for log in args.clang_tidy_log:
        c, n = count_clang_tidy(log)
        critical += c
        noncritical += n

    critical_budget = int(baseline["critical"])
    noncritical_budget = int(baseline["noncritical"])
    reduction = float(baseline.get("min_noncritical_reduction", 0.25))
    allowed_noncritical = int(noncritical_budget * (1.0 - reduction))

    print(
        "static analysis ratchet: "
        f"critical={critical}/{critical_budget}, "
        f"noncritical={noncritical}/{allowed_noncritical}"
    )

    if critical > critical_budget:
        raise SystemExit("critical static-analysis budget exceeded")
    if noncritical > allowed_noncritical:
        raise SystemExit("noncritical static-analysis budget exceeded")


if __name__ == "__main__":
    main()
