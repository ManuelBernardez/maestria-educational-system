#!/usr/bin/env python3
"""Static checks for MaestrIA's native HTML/CSS/ES-module frontend."""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


class AssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        values = dict(attrs)
        for key in ("src", "href"):
            value = values.get(key, "")
            if value:
                self.references.append(value)



def exported_names(module_file: Path, seen: set[Path] | None = None) -> set[str]:
    """Resolve local ES-module named exports, including explicit re-exports."""
    seen = set() if seen is None else seen
    module_file = module_file.resolve()
    if module_file in seen:
        return set()
    seen.add(module_file)
    source = module_file.read_text(encoding="utf-8")
    names = set(re.findall(r"\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)", source))

    for match in re.finditer(r"\bexport\s*\{([^}]+)\}(?:\s*from\s*['\"]([^'\"]+)['\"])?", source, re.S):
        clause, specifier = match.groups()
        if specifier:
            target = (module_file.parent / specifier).resolve()
            if not target.is_file():
                continue
            upstream = exported_names(target, seen.copy())
        else:
            upstream = set()
        for item in clause.split(","):
            item = item.strip()
            if not item:
                continue
            parts = re.split(r"\s+as\s+", item)
            original = parts[0].strip()
            public = parts[-1].strip()
            if not specifier or original in upstream:
                names.add(public)

    for specifier in re.findall(r"\bexport\s+\*\s+from\s+['\"]([^'\"]+)['\"]", source):
        target = (module_file.parent / specifier).resolve()
        if target.is_file():
            names.update(exported_names(target, seen.copy()))
    return names


def validate_named_imports(files: list[Path]) -> list[str]:
    errors: list[str] = []
    pattern = re.compile(r"\bimport\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]", re.S)
    for source_file in files:
        source = source_file.read_text(encoding="utf-8")
        for clause, specifier in pattern.findall(source):
            target = (source_file.parent / specifier).resolve()
            if not target.is_file():
                continue  # Missing paths are reported by the import-path check above.
            available = exported_names(target)
            requested = []
            for item in clause.split(","):
                item = item.strip()
                if not item:
                    continue
                requested.append(re.split(r"\s+as\s+", item)[0].strip())
            for name in requested:
                if name != "type" and name not in available:
                    errors.append(
                        f"{source_file.relative_to(ROOT)} importa '{{ {name} }}' desde "
                        f"{target.relative_to(ROOT)} pero ese módulo no lo exporta"
                    )
    return errors


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


if not FRONTEND.is_dir():
    fail("No existe frontend/.")

html_files = sorted(FRONTEND.rglob("*.html"))
js_files = sorted(FRONTEND.rglob("*.js"))
if not html_files or not js_files:
    fail("No se encontraron páginas HTML o archivos JavaScript.")

missing: list[str] = []
for html_file in html_files:
    parser = AssetParser()
    parser.feed(html_file.read_text(encoding="utf-8"))
    for reference in parser.references:
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc or not parsed.path or parsed.path.startswith(("#", "data:")):
            continue
        if parsed.path.startswith("/"):
            static_path = parsed.path.lstrip("/")
            if static_path.startswith("assets/css/"):
                candidate = FRONTEND / "css" / static_path.removeprefix("assets/css/")
            elif static_path.startswith("assets/js/"):
                candidate = FRONTEND / "js" / static_path.removeprefix("assets/js/")
            else:
                candidate = FRONTEND / static_path
        else:
            candidate = (html_file.parent / parsed.path).resolve()
        try:
            candidate.relative_to(FRONTEND.resolve())
        except ValueError:
            missing.append(f"{html_file.relative_to(ROOT)} -> ruta fuera de frontend: {reference}")
            continue
        if not candidate.exists():
            missing.append(f"{html_file.relative_to(ROOT)} -> recurso inexistente: {reference}")

if missing:
    fail("\n".join(missing[:80]))

module_files = [path for path in js_files if "modules" in path.parts or path.name == "workspace.js"]
missing_imports: list[str] = []
for js_file in module_files:
    source = js_file.read_text(encoding="utf-8")
    for specifier in re.findall(r"""(?:from\s*|import\s*)['"](\.[^'"]+)['"]""", source):
        target = (js_file.parent / specifier).resolve()
        if not target.is_file():
            missing_imports.append(f"{js_file.relative_to(ROOT)} -> {specifier}")

if missing_imports:
    fail("Imports locales inexistentes:\n" + "\n".join(missing_imports))

missing_exports = validate_named_imports(module_files)
if missing_exports:
    fail("Imports nombrados sin export correspondiente:\n" + "\n".join(missing_exports))

node = shutil.which("node")
if node:
    for js_file in js_files:
        result = subprocess.run(
            [node, "--input-type=module", "--check"],
            input=js_file.read_text(encoding="utf-8"),
            text=True,
            capture_output=True,
        )
        if result.returncode:
            fail(f"Sintaxis JavaScript inválida en {js_file.relative_to(ROOT)}:\n{result.stderr}")
else:
    print("WARN: Node.js no está instalado; se omitió la comprobación de sintaxis JS.")

workspace_html = (FRONTEND / "html" / "espacio-docente" / "index.html").read_text(encoding="utf-8")
if '<script type="module" src="/assets/js/workspace.js"></script>' not in workspace_html:
    fail("El espacio docente no está cargando el entrypoint ES module esperado.")
if workspace_html.count('rel="stylesheet"') < 2 or 'href="/assets/css/workspace.css?v=1.0.3"' not in workspace_html:
    fail("El espacio docente no está usando el CSS combinado versionado.")
if 'href="/assets/js/modules/app.js"' not in workspace_html:
    fail("El espacio docente no está precargando el grafo principal de módulos.")
if not (FRONTEND / "js/api.js").is_file():
    fail("Falta el cliente HTTP frontend/js/api.js.")

print(f"OK: {len(html_files)} páginas HTML, {len(js_files)} scripts JS, rutas, exports nombrados y sintaxis verificados.")

guide_module = (ROOT / "frontend/js/modules/features/guide.js").read_text(encoding="utf-8")
app_module = (ROOT / "frontend/js/modules/app.js").read_text(encoding="utf-8")
for action in ("close", "previous", "next", "go"):
    if f"case '{action}'" not in guide_module:
        fail(f"La acción de guía '{action}' no tiene manejador en su raíz persistente.")
if "bindQuickStartEvents" not in app_module or "root.addEventListener('click'" not in guide_module:
    fail("Los controles de guía no están enlazados al contenedor persistente.")
