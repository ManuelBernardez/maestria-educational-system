#!/usr/bin/env python3
"""Guard the strict document CSP against accidental inline code/styles.

Inline styles and scripts are prohibited by the current policy. Keep dynamic
presentation in external stylesheets and toggle classes/properties instead.
"""
from __future__ import annotations

import re
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
ERRORS: list[str] = []

INLINE_STYLE_ATTRIBUTE = re.compile(r"\bstyle\s*=\s*([\"'])", re.IGNORECASE)
INLINE_SCRIPT = re.compile(r"<script\b(?![^>]*\bsrc\s*=)[^>]*>", re.IGNORECASE)
INLINE_STYLE_BLOCK = re.compile(r"<style\b", re.IGNORECASE)
JS_STYLE_MUTATION = re.compile(
    r"(?:\.\s*style\s*\.|\.\s*style\s*=|setAttribute\(\s*['\"]style['\"]|style\.cssText)",
    re.IGNORECASE,
)

for path in sorted((FRONTEND / "html").rglob("*.html")):
    source = path.read_text(encoding="utf-8")
    for pattern, label in (
        (INLINE_STYLE_ATTRIBUTE, "atributo style en línea"),
        (INLINE_SCRIPT, "script en línea"),
        (INLINE_STYLE_BLOCK, "bloque style en línea"),
    ):
        match = pattern.search(source)
        if match:
            line = source.count("\n", 0, match.start()) + 1
            ERRORS.append(f"{path.relative_to(ROOT)}:{line}: {label}")

for path in sorted((FRONTEND / "js").rglob("*.js")):
    source = path.read_text(encoding="utf-8")
    match = JS_STYLE_MUTATION.search(source)
    if match:
        line = source.count("\n", 0, match.start()) + 1
        ERRORS.append(
            f"{path.relative_to(ROOT)}:{line}: mutación directa de estilos; usar clases CSS o controles semánticos"
        )

if ERRORS:
    print("ERROR: el frontend contiene recursos incompatibles con la CSP estricta:", file=sys.stderr)
    print("\n".join(ERRORS), file=sys.stderr)
    raise SystemExit(1)

print("OK: HTML y JavaScript compatibles con la CSP sin estilos/scripts en línea.")
