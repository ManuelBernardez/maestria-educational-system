#!/usr/bin/env python3
"""Dependency-free static validation of local Python imports in backend/."""
from __future__ import annotations

import ast
from functools import lru_cache
from importlib.util import resolve_name
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
EXCLUDED_DIRS = {".venv", "venv", "__pycache__", ".pytest_cache", ".ruff_cache", "staticfiles", "node_modules"}


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def module_path(module_name: str) -> Path | None:
    candidate = BACKEND.joinpath(*module_name.split("."))
    module_file = candidate.with_suffix(".py")
    package_file = candidate / "__init__.py"
    if module_file.is_file():
        return module_file
    if package_file.is_file():
        return package_file
    return None


@lru_cache(maxsize=None)
def defined_names(module_name: str) -> set[str]:
    path = module_path(module_name)
    if path is None:
        return set()
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except SyntaxError as exc:
        fail(f"Sintaxis inválida en {path.relative_to(ROOT)}: {exc}")
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                names.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                for item in ast.walk(target):
                    if isinstance(item, ast.Name):
                        names.add(item.id)
    return names


errors: list[str] = []
files = sorted(
    path for path in BACKEND.rglob("*.py")
    if not any(part in EXCLUDED_DIRS for part in path.relative_to(BACKEND).parts)
)
for source_file in files:
    relative = source_file.relative_to(BACKEND).with_suffix("")
    package_parts = list(relative.parts[:-1])
    if relative.name != "__init__":
        package_name = ".".join(package_parts)
    else:
        package_name = ".".join(relative.parts[:-1])
    try:
        tree = ast.parse(source_file.read_text(encoding="utf-8"), filename=str(source_file))
    except SyntaxError as exc:
        errors.append(f"{source_file.relative_to(ROOT)}: {exc}")
        continue

    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or node.level == 0:
            continue
        relative_name = "." * node.level + (node.module or "")
        try:
            target_name = resolve_name(relative_name, package_name)
        except ImportError as exc:
            errors.append(f"{source_file.relative_to(ROOT)}: import relativo inválido: {exc}")
            continue
        target_file = module_path(target_name)
        if target_file is None:
            errors.append(f"{source_file.relative_to(ROOT)} -> módulo local inexistente: {target_name}")
            continue
        if node.names[0].name == "*":
            continue
        target_names = defined_names(target_name)
        for alias in node.names:
            imported_name = alias.name
            if imported_name not in target_names:
                # `from . import submodule` is valid when that submodule exists.
                submodule = module_path(f"{target_name}.{imported_name}")
                if node.module is None and submodule is not None:
                    continue
                errors.append(
                    f"{source_file.relative_to(ROOT)} importa '{imported_name}' desde "
                    f"{target_name}, pero el símbolo no existe en {target_file.relative_to(ROOT)}"
                )

if errors:
    fail("Imports locales de Python inválidos:\n" + "\n".join(errors))

print(f"OK: {len(files)} módulos Python; imports relativos y símbolos locales verificados.")
