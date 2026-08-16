"""Distribution contracts that source-only tests cannot protect."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path

import tossquant


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT.parent / ".github" / "workflows" / "ci.yml"


def _project() -> dict[str, object]:
    with (ROOT / "pyproject.toml").open("rb") as handle:
        return tomllib.load(handle)


def _workflow_step(workflow: str, name: str) -> str:
    match = re.search(
        rf"(?ms)^      - name: {re.escape(name)}\n(?P<body>.*?)(?=^      - name:|^  [a-zA-Z0-9_-]+:|\Z)",
        workflow,
    )
    assert match is not None, f"CI step not found: {name}"
    return match.group(0)


def test_distribution_version_has_one_hatch_source() -> None:
    config = _project()
    project = config["project"]
    hatch = config["tool"]["hatch"]

    assert "version" not in project
    assert "version" in project["dynamic"]
    assert hatch["version"]["path"] == "src/tossquant/__init__.py"
    assert tossquant.__version__ == "0.2.0"


def test_typer_lower_bound_excludes_broken_click_combination() -> None:
    dependencies = _project()["project"]["dependencies"]

    assert "typer>=0.16" in dependencies


def test_distribution_supplies_iana_timezone_data_without_an_os_database() -> None:
    dependencies = _project()["project"]["dependencies"]

    assert "tzdata>=2026.3" in dependencies


def test_cli_imports_with_only_the_packaged_timezone_database() -> None:
    environment = os.environ.copy()
    environment["PYTHONTZPATH"] = ""
    environment["PYTHONPATH"] = str(ROOT / "src")
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from zoneinfo import ZoneInfo; import tossquant.cli; "
                "ZoneInfo('America/New_York'); ZoneInfo('Asia/Seoul')"
            ),
        ],
        cwd=ROOT,
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_lower_bound_smoke_requirements_pin_the_declared_floors() -> None:
    requirements = {
        line.strip()
        for line in (ROOT / "tests" / "requirements-lower-bounds.txt")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }

    assert {
        "httpx==0.27.0",
        "pydantic==2.7.0",
        "pydantic-settings==2.3.0",
        "rich==13.7.0",
        "tzdata==2026.3",
        "typer==0.16.0",
        "click==8.4.2",
    } <= requirements


def test_ci_exercises_clean_install_upgrade_and_lower_bounds() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    clean = _workflow_step(workflow, "Build and install wheel smoke test")
    upgrade = _workflow_step(workflow, "Upgrade old wheel without force reinstall")
    lower = _workflow_step(workflow, "Verify project lower bounds")

    assert "--force-reinstall" not in clean
    assert 'PYTHONTZPATH=""' in clean
    assert "ZoneInfo('America/New_York')" in clean
    assert "ZoneInfo('Asia/Seoul')" in clean
    assert "tossquant --help" in clean

    assert "tests/fixtures/tossquant_0_1_0" in upgrade
    assert "--force-reinstall" not in upgrade
    assert "claim_live_intent" in upgrade
    assert "importlib.metadata.version" in upgrade
    assert "tossquant --help" in upgrade

    assert "tests/requirements-lower-bounds.txt" in lower
    assert "--no-deps" in lower
    assert 'PYTHONTZPATH=""' in lower
    assert "tossquant --help" in lower

    assert "windows-wheel-smoke:" in workflow
    assert "runs-on: windows-latest" in workflow
    assert '$env:PYTHONTZPATH = ""' in workflow
    assert "ZoneInfo('America/New_York')" in workflow
    assert "ZoneInfo('Asia/Seoul')" in workflow
