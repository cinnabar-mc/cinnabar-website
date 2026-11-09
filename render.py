#!/usr/bin/env python3
"""Render the standalone site using Cinnabar's original artwork and release filenames."""

import argparse
import json
import os
import re
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
from urllib.parse import quote
import xml.etree.ElementTree as ET

from source import CHECKOUT, load_config
from mdbook import binary


HERE = Path(__file__).resolve().parent
MARKETPLACE_LINK = '      <a class="marketplace-link" href="/mods/" aria-current="page">Marketplace</a>\n'
INPUTS = load_config()["inputs"]
# In-game screenshots of the mod shown on /mod/.
MOD_CAPTURES = ("mods.webp", "settings.webp", "layout.webp")
# Files served under /assets/: gameplay captures and any self-hosted fonts.
PUBLIC_ASSETS = ("gameplay", "fonts")


def build_book(repository, output, red, header):
    """Build the pinned book with site-owned styling without changing its source."""
    book = repository / INPUTS["modding"]
    if not (book / "book.toml").is_file():
        raise FileNotFoundError("The pinned client inputs must contain docs/modding/book.toml")
    executable = binary()
    destination = output.resolve() / "docs" / "modding"
    with tempfile.TemporaryDirectory() as temporary:
        staged = Path(temporary) / "book"
        shutil.copytree(book, staged)
        theme = staged / "theme"
        shutil.copytree(HERE / "docs-theme", theme, dirs_exist_ok=True)
        shutil.copyfile(repository / INPUTS["icon"], theme / "favicon.svg")
        stylesheet = theme / "cinnabar.css"
        stylesheet.write_text((HERE / "site-header.css").read_text(encoding="utf-8")
                              + stylesheet.read_text(encoding="utf-8").replace("@@RED@@", red))
        (theme / "header.hbs").write_text(header.replace("@@DOCS_CURRENT@@", ' aria-current="page"').replace("@@MOD_CURRENT@@", "").replace("@@MARKETPLACE_LINK@@", ""))
        environment = dict(os.environ, **{
            "MDBOOK_OUTPUT__HTML__THEME": "theme",
            "MDBOOK_OUTPUT__HTML__ADDITIONAL_CSS": '["theme/cinnabar.css"]',
            "MDBOOK_OUTPUT__HTML__DEFAULT_THEME": "navy",
            "MDBOOK_OUTPUT__HTML__PREFERRED_DARK_THEME": "navy",
            "MDBOOK_OUTPUT__HTML__NO_SECTION_LABEL": "true",
            "MDBOOK_OUTPUT__HTML__PRINT": '{"enable":false}',
            "MDBOOK_OUTPUT__HTML__SITE_URL": "/docs/modding/",
        })
        if destination.exists():
            shutil.rmtree(destination)
        subprocess.run([str(executable), "build", str(staged), "--dest-dir", str(destination)],
                       env=environment, check=True)
    label_chapter_links(destination)


def label_chapter_links(book):
    """Name the destination of each chapter's Previous and Next card, which mdBook leaves blank."""
    card = re.compile(r'(<a rel="[^"]*" href="([^"#]+)[^"]*" class="mobile-nav-chapters (previous|next)" '
                      r'title="[^"]*" aria-label=")[^"]*("[^>]*>)')
    for page in book.rglob("*.html"):
        def named(match):
            """Rewrite one card from the title of the chapter it links to."""
            target = (page.parent / match[2]).resolve()
            source = re.search(r"<title>(.*?)</title>", target.read_text(), re.S)
            name = source[1].rpartition(" - ")[0].strip() or source[1].strip()
            direction = "Previous" if match[3] == "previous" else "Next"
            return f'{match[1]}{direction} chapter: {name}{match[4]}<span class="chapter-name">{name}</span>'
        html = page.read_text()
        labelled = card.sub(named, html)
        if labelled != html:
            page.write_text(labelled)


def capability_descriptors(text):
    """Extract the pinned client's declarative fields, failing on unsupported types."""
    body = text.split("grants! {", 1)[1].split("\n}", 1)[0]
    pattern = r'(?:\s*///[^\n]*\n)+\s*#\[permission\(("(?:[^"\\]|\\.)*"), (true|false)(?:, (true|false))?\)\]\s*pub (\w+): ([^,]+),'
    result = []
    for match in re.finditer(pattern, body):
        label, sensitive, packet_only, name, kind = match.groups()
        if kind not in {"bool", "Vec<String>"}:
            raise ValueError("unsupported grant type: " + kind)
        docs = " ".join(re.findall(r'///\s*(.*)', match.group(0)))
        result.append({"name": name, "label": json.loads(label), "description": docs,
                       "sensitive": sensitive == "true", "packet_only": packet_only == "true",
                       "type": "commands" if kind == "Vec<String>" else "boolean"})
    if not result or len(result) != len(re.findall(r'pub \w+:', body)):
        raise ValueError("client capability declarations changed; update the extractor")
    return result


def build(repository, output, marketplace_backend="http"):
    """Render site files from the declared inputs in a client checkout."""
    config = json.loads((repository / INPUTS["release_manifest"]).read_text(encoding="utf-8"))
    repository_url = "https://github.com/" + config["repository"]
    config["release_url"] = repository_url + "/releases/latest"
    config["download_base"] = config["release_url"] + "/download/"
    config["install_command"] = (
        f'curl -fsSL {config["download_base"]}{config["install_script"]} | sh'
    )
    config["nightly_base"] = repository_url + "/releases/download/nightly/"
    config["nightly_install_command"] = config["install_command"] + " -s -- --channel nightly"
    contract = json.loads((repository / INPUTS["api_contract"]).read_text(encoding="utf-8"))
    api_origin = next(value["value"] for value in contract["constants"]
                      if value["rust_name"] == "CINNABAR_API_BASE_URL")
    config["online_count_url"] = api_origin.rstrip("/") + "/v1/presence/count"
    config["unique_count_url"] = api_origin.rstrip("/") + "/v1/users/count"
    config["download_count_url"] = api_origin.rstrip("/") + "/v1/downloads/count"
    config["online_history_url"] = api_origin.rstrip("/") + "/v1/presence/history"
    if marketplace_backend not in {"http", "mock"}:
        raise ValueError("marketplace backend must be http or mock")
    config["marketplace"] = {"api_url": api_origin.rstrip("/") + "/v1", "backend": marketplace_backend}
    capabilities = capability_descriptors((repository / INPUTS["mod_grants"]).read_text(encoding="utf-8"))
    icon = (repository / INPUTS["icon"]).read_text(encoding="utf-8")
    red = ET.fromstring(icon).find("{http://www.w3.org/2000/svg}rect").attrib["fill"]
    replacements = {
        "@@DISCORD_MARK@@": (repository / INPUTS["discord_mark"]).read_text(encoding="utf-8").strip(),
        "@@RED@@": red,
        "@@FAVICON@@": "data:image/svg+xml," + quote(icon, safe=""),
        "@@REPOSITORY_URL@@": repository_url,
        "@@API_ORIGIN@@": api_origin.rstrip("/"),
        "@@SITE_HEADER_STYLES@@": (HERE / "site-header.css").read_text(encoding="utf-8"),
    }
    output.mkdir(parents=True, exist_ok=True)
    header = (HERE / "site-header.html.in").read_text(encoding="utf-8")
    for marker, value in replacements.items():
        header = header.replace(marker, value)
    for template, target in (("index.html.in", "index.html"), ("mod.html.in", "mod/index.html"), ("mods.html.in", "mods/index.html")):
        page_header = header.replace("@@DOCS_CURRENT@@", "").replace(
            "@@MOD_CURRENT@@", ' aria-current="page"' if target.startswith("mod/") else "").replace(
            # The marketplace is hidden from the rest of the site for now; only its own page links to itself.
            "@@MARKETPLACE_LINK@@", MARKETPLACE_LINK if target.startswith("mods/") else "")
        page = (HERE / template).read_text(encoding="utf-8").replace("@@SITE_HEADER@@", page_header)
        for marker, value in replacements.items():
            page = page.replace(marker, value)
        destination = output / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(page, encoding="utf-8")
    for capture in MOD_CAPTURES:
        shutil.copyfile(HERE / "assets" / "mod" / capture, output / "mod" / capture)
    (output / "marketplace.css").write_text((HERE / "marketplace.css").read_text(encoding="utf-8").replace("@@RED@@", red), encoding="utf-8")
    serialized = json.dumps(capabilities, ensure_ascii=True)
    (output / "marketplace-capabilities.js").write_text(
        '(function(data){if(typeof module!=="undefined"&&module.exports)module.exports=data;'
        'else window.CinnabarCapabilities=data;})(' + serialized + ');\n', encoding="utf-8")
    (output / "marketplace").mkdir(exist_ok=True)
    shutil.copyfile(output / "mods/index.html", output / "marketplace/index.html")
    for script in ("marketplace-core.js", "marketplace-mock.js", "marketplace-http.js",
                   "marketplace-content.js", "marketplace-discovery.js", "marketplace-validation.js", "marketplace-upload.js", "marketplace.js"):
        shutil.copyfile(HERE / script, output / script)
    subprocess.run(["node", str(HERE / "build-validator.mjs"), str(output / "validator")], check=True)
    (output / "downloads.js").write_text("window.CINNABAR_DOWNLOADS = " + json.dumps(config) + ";\n")
    shutil.copyfile(HERE / "app.js", output / "app.js")
    shutil.copyfile(HERE / "activity.js", output / "activity.js")
    shutil.copyfile(HERE / "presence.js", output / "presence.js")
    shutil.copyfile(HERE / "download-count.js", output / "download-count.js")
    shutil.copyfile(HERE / "history.js", output / "history.js")
    shutil.copyfile(repository / INPUTS["title"], output / "title.png")
    for directory in PUBLIC_ASSETS:
        if (HERE / "assets" / directory).is_dir():
            shutil.copytree(HERE / "assets" / directory, output / "assets" / directory, dirs_exist_ok=True)
    rng = random.Random(27)
    colors = ["#1c221d", "#202620", "#242a23", "#262d25", "#1f251f"]
    pixels = "".join(
        f'<rect x="{x}" y="{y}" width="16" height="16" fill="{rng.choice(colors)}"/>'
        for y in range(0, 256, 16) for x in range(0, 256, 16)
    )
    (output / "texture.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' + pixels + "</svg>"
    )
    build_book(repository, output, red, header)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=CHECKOUT)
    parser.add_argument("--output", type=Path, default=HERE / "dist")
    parser.add_argument("--marketplace-backend", choices=("http", "mock"), default="http",
                        help="use mock only for an explicitly labelled local preview")
    args = parser.parse_args()
    build(args.source, args.output, args.marketplace_backend)
