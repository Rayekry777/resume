"""Convert locally captured, rendered Laoyu DOM into an editable resume backup.

  python scripts/convert-laoyu-migration.py --input-dir output/migration
  python scripts/convert-laoyu-migration.py --input-dir output/migration --photo source-1=avatar.jpg
  python scripts/convert-laoyu-migration.py --self-test

No browser access, remote requests, package installation or application changes.
HTML is parsed by the Python standard library. Existing Vite and application
modules validate documents, generate Markdown/ZIP and verify a real ZIP import
using an isolated fake IndexedDB. Personal content is never embedded in code.
"""
from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
BLOCKS = {"div", "p", "section", "article", "main", "header", "footer", "li", "ul", "ol", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "table", "tr", "td"}
DROP = {"script", "style", "noscript", "button", "svg"}
SECTIONS = {"education": "education", "experience": "experience", "work": "experience", "internship": "experience", "project": "project", "skill": "skill", "award": "award", "research": "research", "portfolio": "portfolio", "summary": "summary", "introduction": "summary", "custom": "custom"}
CHINESE_SECTIONS = {"教育": "education", "工作": "experience", "实习": "experience", "项目": "project", "技能": "skill", "奖": "award", "研究": "research", "作品": "portfolio", "简介": "summary", "评价": "summary"}
PROFILE = {"name": "name", "姓名": "name", "phone": "phone", "telephone": "phone", "mobile": "phone", "电话": "phone", "手机": "phone", "email": "email", "邮箱": "email", "city": "city", "workplace": "city", "城市": "city", "location": "city", "website": "website", "网站": "website", "github": "github", "status": "status", "currentstatus": "status", "状态": "status", "position": "title", "positiontitle": "title", "title": "title", "job": "title", "职位": "title", "求职意向": "title"}

# This bridge contains only application plumbing, never captured personal data.
BRIDGE = r"""
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
const [action, payloadPath, outputDirectory, outputPrefix] = process.argv.slice(2);
const server = await createServer({ root: process.cwd(), configFile: false,
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
try {
  const model = await server.ssrLoadModule('/src/model.ts');
  const templates = await server.ssrLoadModule('/src/templates.ts');
  const references = await server.ssrLoadModule('/src/templateReferences.ts');
  if (action === 'config') {
    console.log(JSON.stringify({ defaults: model.DEFAULT_LAYOUT, markdown: templates.MD_REFERENCE.defaultLayout,
      references: references.TEMPLATE_REFERENCES, labels: model.SECTION_LABELS }));
  } else {
    await import('fake-indexeddb/auto');
    const storage = await server.ssrLoadModule('/src/lib/storage.ts');
    const backup = await server.ssrLoadModule('/src/lib/backup.ts');
    const markdown = await server.ssrLoadModule('/src/lib/markdown.ts');
    const payload = JSON.parse(await fs.readFile(payloadPath, 'utf8'));
    const warnings = [];
    const documents = payload.documents.map(document => {
      if (document.editorMode === 'markdown' && !document.sections.length) {
        const parsed = markdown.parseMarkdown(document.markdownSource, document.title);
        warnings.push(...parsed.warnings);
        const profile = { ...parsed.document.profile };
        for (const [key, value] of Object.entries(document.profile)) if (value) profile[key] = value;
        document = { ...parsed.document, ...document, profile, sections: parsed.document.sections };
      }
      const validated = storage.validateResumeDocument(document, warnings);
      const plain = node => (node.text ?? '') + (node.content ?? []).map(plain).join('');
      for (let section = 0; section < document.sections.length; section++) {
        for (let item = 0; item < document.sections[section].items.length; item++) {
          const before = document.sections[section].items[item], after = validated.sections[section].items[item];
          for (const key of ['title', 'subtitle', 'location', 'startDate', 'endDate', 'url']) {
            if (before[key] !== after[key]) throw new Error(`Storage validation changed a migrated field: section ${section + 1}, item ${item + 1}, ${key}`);
          }
          if (plain(before.description) !== plain(after.description)) throw new Error('Storage validation changed migrated body text');
        }
      }
      return validated;
    });
    for (const asset of payload.assets) {
      const bytes = await fs.readFile(asset.localFile);
      await storage.putAsset({ id: asset.id, name: asset.name, createdAt: Date.now(), blob: new Blob([bytes]) });
    }
    const blob = await backup.exportBackup(documents);
    const restored = await backup.importBackup(blob);
    if (restored.documents.length !== documents.length) throw new Error('ZIP round-trip document count mismatch');
    for (let index = 0; index < documents.length; index++) {
      const original = documents[index], copy = restored.documents[index];
      for (const key of ['title', 'sections', 'layout', 'editorMode', 'markdownSource']) {
        if (JSON.stringify(original[key]) !== JSON.stringify(copy[key])) throw new Error(`ZIP round-trip mismatch: document ${index + 1}, ${key}`);
      }
      const { photoId: firstPhoto, ...firstProfile } = original.profile;
      const { photoId: copyPhoto, ...copyProfile } = copy.profile;
      if (JSON.stringify(firstProfile) !== JSON.stringify(copyProfile)) throw new Error('ZIP profile mismatch');
      if (firstPhoto) {
        const before = await storage.getAsset(firstPhoto), after = await storage.getAsset(copyPhoto);
        if (!before || !after || Buffer.compare(Buffer.from(await before.blob.arrayBuffer()), Buffer.from(await after.blob.arrayBuffer()))) throw new Error('ZIP photo mismatch');
      }
    }
    const zipPath = path.join(outputDirectory, `${outputPrefix}.resume.zip`);
    await fs.writeFile(zipPath, new Uint8Array(await blob.arrayBuffer()), { flag: 'wx' });
    const markdownFiles = [];
    for (let index = 0; index < documents.length; index++) {
      const doc = documents[index], filename = `${outputPrefix}-${payload.sourceStems[index]}.${doc.editorMode === 'markdown' ? 'markdown' : 'form'}.md`;
      const source = markdown.exportMarkdown(doc);
      if (doc.editorMode === 'markdown' && source !== payload.documents[index].markdownSource) throw new Error('Original Markdown source changed');
      await fs.writeFile(path.join(outputDirectory, filename), source, { encoding: 'utf8', flag: 'wx' });
      markdownFiles.push(filename);
    }
    await fs.writeFile(path.join(outputDirectory, `${outputPrefix}.documents.json`), JSON.stringify(documents, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ zip: zipPath, markdownFiles, documentCount: documents.length,
      photoCount: payload.assets.length, zipBytes: blob.size, warnings: [...warnings, ...restored.warnings] }));
  }
} finally { await server.close(); }
"""


@dataclass(eq=False)
class Element:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list = field(default_factory=list)


class TreeParser(HTMLParser):
    def __init__(self, source: str):
        super().__init__(convert_charrefs=True)
        self.root = Element("root")
        self.stack = [self.root]
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        node = Element(tag.lower(), dict((key, value or "") for key, value in attrs))
        self.stack[-1].children.append(node)
        if tag.lower() not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.stack[-1].tag == tag.lower() and tag.lower() not in VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag.lower():
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def elements(node):
    if isinstance(node, Element):
        yield node
        for child in node.children:
            yield from elements(child)


def raw_text(node):
    if isinstance(node, str):
        return node
    if node.tag in DROP:
        return ""
    if node.tag == "br":
        return "\n"
    return "".join(raw_text(child) for child in node.children)


def compact(value):
    return re.sub(r"\s+", "", value)


def styles(value):
    if isinstance(value, dict):
        return value
    return dict((key.strip().lower(), val.strip()) for part in str(value or "").split(";") if ":" in part for key, val in [part.split(":", 1)])


def css_color(value):
    value = str(value or "").strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        return value.lower()
    if re.fullmatch(r"#[0-9a-fA-F]{3}", value):
        return "#" + "".join(char * 2 for char in value[1:]).lower()
    match = re.match(r"rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)", value)
    if match:
        return "#" + "".join(f"{min(255, int(channel)):02x}" for channel in match.groups())
    return {"black": "#000000", "white": "#ffffff", "red": "#ff0000", "blue": "#0000ff", "green": "#008000"}.get(value.lower())


def css_pixels(value):
    if isinstance(value, (float, int)) and not isinstance(value, bool):
        return float(value)
    match = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*(px|pt)?\s*", str(value or ""))
    return float(match[1]) * (4 / 3 if match[2] == "pt" else 1) if match else None


def mark_list(node, inherited, scale):
    result = list(inherited)
    style = styles(node.attrs.get("style"))
    weight = style.get("font-weight", "")
    if node.tag in {"strong", "b"} or weight in {"bold", "bolder"} or (weight.isdigit() and int(weight) >= 600):
        result.append({"type": "bold"})
    if node.tag in {"em", "i"} or style.get("font-style") in {"italic", "oblique"}:
        result.append({"type": "italic"})
    decoration = style.get("text-decoration", "") + style.get("text-decoration-line", "")
    if node.tag == "u" or "underline" in decoration:
        result.append({"type": "underline"})
    if node.tag in {"s", "strike", "del"} or "line-through" in decoration:
        result.append({"type": "strike"})
    if node.tag == "code":
        result.append({"type": "code"})
    attrs = {}
    color = css_color(style.get("color", node.attrs.get("color")))
    if color:
        attrs["color"] = color
    size = css_pixels(style.get("font-size"))
    if size is not None:
        point_size = size * scale
        if not 5 <= point_size <= 40:
            raise ValueError("Inline font size exceeds the application's 5..40pt range; inspect the captured source")
        attrs["fontSize"] = f"{point_size:.2f}pt"
    if attrs:
        result.append({"type": "textStyle", "attrs": attrs})
    if node.tag == "a" and re.match(r"^(https?://|mailto:|tel:)", node.attrs.get("href", ""), re.I):
        result.append({"type": "link", "attrs": {"href": node.attrs["href"]}})
    # Merge nested textStyle marks rather than silently losing the inner colour/size.
    text_style = {}
    unique = []
    for mark in result:
        if mark["type"] == "textStyle":
            text_style.update(mark["attrs"])
        elif mark not in unique:
            unique.append(mark)
    return unique + ([{"type": "textStyle", "attrs": text_style}] if text_style else [])


def html_to_rich(root, scale, excluded=None):
    excluded = excluded or set()

    def inline(node, marks):
        if isinstance(node, str):
            return [{"type": "text", "text": node, **({"marks": marks} if marks else {})}] if node else []
        if node in excluded or node.tag in DROP:
            return []
        if node.tag == "br":
            return [{"type": "hardBreak"}]
        if node.tag == "img":
            # Inline body images cannot be represented by the present schema.
            if node.attrs.get("alt"):
                raise ValueError("An inline image has alternative text; migrate it explicitly instead of discarding it")
            return []
        next_marks = mark_list(node, marks, scale)
        return [part for child in node.children for part in inline(child, next_marks)]

    def blocks(children, marks=None):
        result, pending = [], []
        marks = marks or []

        def flush():
            nonlocal pending
            if pending and any(part.get("type") == "hardBreak" or part.get("text", "").strip() for part in pending):
                result.append({"type": "paragraph", "content": pending})
            pending = []

        for node in children:
            if isinstance(node, str):
                pending.extend(inline(node, marks))
                continue
            if node in excluded or node.tag in DROP:
                continue
            if node.tag in {"ul", "ol"}:
                flush()
                items = []
                for child in node.children:
                    if isinstance(child, Element) and child.tag == "li":
                        items.append({"type": "listItem", "content": blocks(child.children, mark_list(child, marks, scale)) or [{"type": "paragraph"}]})
                attrs = {"start": int(node.attrs.get("start", "1"))} if node.tag == "ol" else {}
                result.append({"type": "orderedList" if node.tag == "ol" else "bulletList", **({"attrs": attrs} if attrs else {}), "content": items})
            elif node.tag == "pre":
                flush()
                result.append({"type": "codeBlock", "content": [{"type": "text", "text": raw_text(node)}]})
            elif node.tag == "blockquote":
                flush()
                result.append({"type": "blockquote", "content": blocks(node.children, mark_list(node, marks, scale))})
            elif node.tag == "hr":
                flush()
                result.append({"type": "horizontalRule"})
            elif node.tag in BLOCKS:
                flush()
                next_marks = mark_list(node, marks, scale)
                nested = any(isinstance(child, Element) and child.tag in BLOCKS for child in node.children)
                if nested:
                    result.extend(blocks(node.children, next_marks))
                else:
                    content = [part for child in node.children for part in inline(child, next_marks)]
                    if content:
                        attrs = {}
                        align = styles(node.attrs.get("style")).get("text-align")
                        if align in {"left", "center", "right", "justify"}:
                            attrs["textAlign"] = align
                        kind = "heading" if re.fullmatch(r"h[1-6]", node.tag) else "paragraph"
                        if kind == "heading":
                            attrs["level"] = int(node.tag[1])
                        result.append({"type": kind, **({"attrs": attrs} if attrs else {}), "content": content})
            else:
                pending.extend(inline(node, marks))
        flush()
        return result

    return {"type": "doc", "content": blocks(root.children) or [{"type": "paragraph"}]}


def rich_text(node):
    return node.get("text", "") + "".join(rich_text(child) for child in node.get("content", []))


def section_type(value, title):
    normalized = re.sub(r"(?:list|section|item|[-_\s])", "", str(value).lower())
    if normalized in SECTIONS:
        return SECTIONS[normalized]
    for key, result in CHINESE_SECTIONS.items():
        if key in str(title):
            return result
    return "custom"


def convert_item(source, kind, scale, notes):
    tree = TreeParser(str(source.get("html", ""))).root
    fields = source.get("fields") or {}
    if not isinstance(fields, dict):
        raise ValueError("item.fields must be an object")
    result = {"id": str(uuid.uuid4()), "title": "", "subtitle": "", "location": "", "startDate": "", "endDate": "", "url": ""}
    aliases = {"title": ["name", "title", "school", "company", "projectName", "skillName"], "subtitle": ["subtitle", "major", "degree", "position", "role", "department"], "location": ["location", "city"], "startDate": ["startDate", "time", "date", "duration"], "endDate": ["endDate"], "url": ["url", "website", "link"]}
    for destination, keys in aliases.items():
        values = [str(fields[key]) for key in keys if key in fields and fields[key] is not None and str(fields[key])]
        result[destination] = " · ".join(values) if destination == "subtitle" else (values[0] if values else "")
    excluded = set()
    class_fields = {
        "title": {"school", "schoolname", "educationname", "companyname", "workname", "projectname", "skillname", "awardname", "researchname", "portfolioname"},
        "subtitle": {"major", "degree", "academicdegree", "degreetype", "positionname", "rolename", "departmentname"},
        "location": {"location", "locationname", "cityname"},
        "startDate": {"educationtime", "starttoendtime", "worktime", "companytime", "experiencetime", "projecttime", "awardtime", "researchtime", "time"},
    }
    if "descriptionHtml" not in source:
        for destination, selectors in class_fields.items():
            matches = []
            for element in elements(tree):
                if set(element.attrs.get("class", "").lower().split()) & selectors:
                    if any(element in set(elements(ancestor)) for ancestor in matches):
                        continue
                    matches.append(element)
            values = [raw_text(element).strip() for element in matches if raw_text(element).strip()]
            if values:
                if not result[destination]:
                    result[destination] = " · ".join(values) if destination == "subtitle" else values[0]
                    # Extra fields remain visible in the body instead of being dropped.
                    selected = matches if destination == "subtitle" else matches[:1]
                    excluded.update(selected)
                elif compact("".join(values)) == compact(result[destination]):
                    excluded.update(matches)
    body_tree = TreeParser(str(source["descriptionHtml"])).root if "descriptionHtml" in source else tree
    result["description"] = html_to_rich(body_tree, scale, excluded)
    def retained_body(node):
        if isinstance(node, str):
            return node
        if node in excluded or node.tag in DROP:
            return ""
        if node.tag == "br":
            return "\n"
        return "".join(retained_body(child) for child in node.children)
    if compact(retained_body(body_tree)) != compact(rich_text(result["description"])):
        raise ValueError("Body integrity check failed: original words/order must remain unchanged")
    if not source.get("html") and "descriptionHtml" not in source and source.get("text"):
        result["description"] = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": str(source["text"])}]}]}
    captured = raw_text(tree) if source.get("html") else str(source.get("text", ""))
    converted = "".join(str(result[key]) for key in ["title", "subtitle", "location", "startDate", "endDate", "url"]) + rich_text(result["description"])
    # Check character counts, because headers move before the body and therefore reorder DOM text.
    from collections import Counter
    missing = Counter(compact(captured)) - Counter(compact(converted))
    if missing:
        raise ValueError("Item text integrity check failed; header extraction would lose rendered characters")
    if source.get("text"):
        missing_ui = Counter(compact(str(source["text"]))) - Counter(compact(converted))
        if missing_ui:
            raise ValueError("Captured visible item text differs from HTML conversion; inspect the source item")
    return result


# External IDs are only needed by this one-time capture converter.
LEGACY_TEMPLATE_KEYS = {
    "1685547340318179330": "neat",
    "1689570999752585217": "frontend-pro",
    "1831655666372919315": "elegant",
    "1689625240613548033": "operations",
    "1688474223930810369": "mono",
    "1685527024170762241": "minimal",
    "1685833217187577858": "creative",
    "1685839963780087809": "engineering",
    "1788106477284544514": "professional",
    "1689825252257587216": "java-campus",
    "1686269189977653249": "organized",
    "1689825252257587215": "java-pro",
    "1990000000000000136": "steady",
    "1686223336789327874": "graduate",
    "1689825252257587217": "java-intern",
    "1686268545216659458": "fresh",
    "1685850765497008130": "classic",
    "1689571374408790018": "frontend-campus",
    "1706564103315402753": "modern",
    "1689625500391960577": "operations-campus",
    "1689571207827812354": "frontend-intern",
}


def convert_document(source, config, stem, notes):
    markdown = source.get("channel") == "markdown"
    paper = styles(source.get("paperStyle"))
    width = css_pixels(paper.get("width", paper.get("--rmd-paper-width"))) or (700 if markdown else 689)
    if not 600 <= width <= 800:
        raise ValueError("Expected an unscaled 689/700px source paper, not a scaled screen rectangle")
    scale = 595.28 / width
    source_id = str(source.get("templateSourceId", ""))
    if not source_id:
        found = re.search(r"yu-(\d+)", str(source.get("paperClass", "")))
        source_id = found[1] if found else ""
    template = LEGACY_TEMPLATE_KEYS.get(source_id, "neat")
    if source_id not in LEGACY_TEMPLATE_KEYS:
        notes.append({"source": stem, "kind": "template-fallback", "sourceId": source_id})
    layout = {**config["defaults"], **config["references"][template]["defaultLayout"], **(config["markdown"] if markdown and template == "neat" else {})}
    font = css_pixels(paper.get("fontSize", paper.get("font-size", paper.get("--rmd-font-size-base", paper.get("font")))))
    line = css_pixels(paper.get("lineHeight", paper.get("line-height", paper.get("--rmd-line-height-base", paper.get("line")))))
    if font:
        layout["fontSize"] = font * scale
    if line:
        layout["lineHeight"] = line * scale / layout["fontSize"]
    original_settings = {"marginTop": "--resume-padding-top", "marginLeft": "--resume-padding-left", "marginRight": "--resume-padding-right", "contentIndent": "--resume-content-indent", "sectionGap": "--resume-module-padding-top", "titleTopGap": "--resume-title-margin-top", "titleGap": "--resume-title-margin-bottom"}
    if markdown and paper.get("--rmd-page-padding"):
        padding = [css_pixels(part) for part in paper["--rmd-page-padding"].split()]
        if len(padding) == 4 and all(value is not None for value in padding):
            layout.update(marginTop=padding[0] * scale, marginRight=padding[1] * scale, marginLeft=padding[3] * scale, marginHorizontal=padding[3] * scale)
    for key in ["marginTop", "marginHorizontal", "marginLeft", "marginRight", "contentIndent", "sectionGap", "titleTopGap", "titleGap"]:
        hyphenated = re.sub(r"[A-Z]", lambda match: "-" + match[0].lower(), key)
        number = css_pixels(paper.get(key, paper.get(hyphenated, paper.get(original_settings.get(key), paper.get("--rmd-section-gap") if key == "sectionGap" else None))))
        if number is not None:
            layout[key] = number * scale
    accent = css_color(paper.get("accent", paper.get("--resume-theme", paper.get("--rmd-primary"))))
    if accent:
        layout["accent"] = accent
    if paper.get("headerAlign") in {"left", "center", "right"}:
        layout["headerAlign"] = paper["headerAlign"]
    profile = dict.fromkeys(["name", "title", "email", "phone", "city", "website", "github", "status"], "")
    unknown_profile = []
    for field in source.get("profile", []):
        value = str(field.get("text", ""))
        key = re.sub(r"[-_\s]", "", str(field.get("key", "")).lower())
        target = PROFILE.get(key)
        if target and value:
            if profile[target] and profile[target] != value:
                unknown_profile.append(field)
            else:
                profile[target] = value
        elif value:
            unknown_profile.append(field)
    if unknown_profile:
        labels = {"highestdegree": "学历", "gender": "性别", "age": "年龄", "salary": "期望薪资", "workplace": "期望工作地"}
        profile["extraFields"] = [{"key": str(value.get("key") or f"extra-{index + 1}"), "label": str(value.get("label") or labels.get(re.sub(r"[-_\s]", "", str(value.get("key", "")).lower()), value.get("key") or f"附加信息{index + 1}")), "value": str(value.get("text", ""))} for index, value in enumerate(unknown_profile)]
    sections = []
    for module in source.get("modules", []):
        title = str(module.get("title", ""))
        kind = section_type(module.get("type", ""), title)
        sections.append({"id": str(uuid.uuid4()), "type": kind, "title": title or config["labels"][kind], "visible": True, "pageBreakBefore": bool(module.get("pageBreakBefore", False)), "items": [convert_item(item, kind, scale, notes) for item in module.get("items", [])]})
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    document = {"id": str(uuid.uuid4()), "schemaVersion": 1, "title": str(source.get("title") or "迁移的简历"), "createdAt": now, "updatedAt": now, "revision": 0, "templateId": template, "profile": profile, "sections": sections, "layout": layout, "editorMode": "markdown" if markdown else "visual"}
    if markdown:
        if not isinstance(source.get("markdownSource"), str):
            raise ValueError(f"{stem}: Markdown document requires its complete original markdownSource")
        document["markdownSource"] = source["markdownSource"]
    return document


def node_binary(requested=None):
    candidates = [requested, os.environ.get("NODE_BINARY"), shutil.which("node"), "D:/aitool/node/node.exe"]
    return next((str(Path(value).resolve()) for value in candidates if value and Path(value).is_file()), "node")


def bridge(node, action, *arguments):
    result = subprocess.run([node, "--input-type=module", "-", action, *map(str, arguments)], input=BRIDGE, text=True, encoding="utf-8", cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError("Application validation/ZIP check failed:\n" + result.stderr[-6000:])
    return json.loads(result.stdout.strip().splitlines()[-1])


def migrate(input_dir, output_dir, node, photo_options, allow_missing=False):
    input_dir, output_dir = Path(input_dir).resolve(), Path(output_dir).resolve()
    for forbidden in [ROOT / "public", ROOT / "src", ROOT / "dist"]:
        if output_dir.is_relative_to(forbidden):
            raise ValueError("Personal migration output must not be placed in public/, src/ or dist/")
    sources = sorted(input_dir.glob("source-*.json"))
    if not sources:
        raise ValueError("No source-*.json captures found in the input directory")
    config = bridge(node, "config")
    output_dir.mkdir(parents=True, exist_ok=True)
    notes, documents, assets, stems = [], [], [], []
    for filename in sources:
        source = json.loads(filename.read_text(encoding="utf-8-sig"))
        stem = filename.stem
        document = convert_document(source, config, stem, notes)
        photo = photo_options.get(stem) or source.get("photoFile")
        if photo:
            photo = Path(photo)
            photo = photo if photo.is_absolute() else input_dir / photo
        else:
            photo = next((path for extension in ["jpg", "jpeg", "png", "webp"] for path in [input_dir / f"{stem}-photo.{extension}"] if path.is_file()), None)
        if photo:
            if not photo.is_file():
                raise ValueError(f"{stem}: supplied local portrait does not exist")
            asset_id = str(uuid.uuid4())
            assets.append({"id": asset_id, "name": photo.name, "localFile": str(photo.resolve())})
            document["profile"]["photoId"] = asset_id
        elif source.get("photoUrl"):
            if not allow_missing:
                raise ValueError(f"{stem}: captured portrait needs a local photoFile/--photo; remote photoUrl is never fetched")
            notes.append({"source": stem, "kind": "missing-photo-explicitly-allowed"})
        documents.append(document)
        stems.append(stem)
    counts = {title: sum(doc["title"] == title for doc in documents) for title in {doc["title"] for doc in documents}}
    for document in documents:
        if counts[document["title"]] > 1:
            document["title"] += "（Markdown版）" if document["editorMode"] == "markdown" else "（普通版）"
    prefix = "laoyu-migration-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    with tempfile.TemporaryDirectory(prefix=".migration-work-", dir=output_dir) as temp:
        payload = Path(temp) / "payload.json"
        payload.write_text(json.dumps({"documents": documents, "assets": assets, "sourceStems": stems}, ensure_ascii=False), encoding="utf-8")
        summary = bridge(node, "convert", payload, output_dir, prefix)
    report = {"sources": [str(path) for path in sources], "result": summary, "notes": notes, "verified": "application exportBackup -> importBackup; document content/layout/source and photo bytes compared"}
    (output_dir / f"{prefix}.report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary, notes


def self_test(node):
    (ROOT / "tmp").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="migration-self-test-", dir=ROOT / "tmp") as directory:
        directory = Path(directory)
        portrait = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=")
        (directory / "source-1-photo.png").write_bytes(portrait)
        html = '<div><div class="projectName">测试项目</div><div class="projectTime">2024.01 ~ 至今</div><p>完整保留<strong>粗体</strong>与<em>斜体</em>及<a href="https://example.com">链接</a>。</p><ol start="3"><li>第一项<ul><li>嵌套项</li></ul></li><li><span style="font-size:16px;color:rgb(70,114,241)">局部样式</span></li></ol></div>'
        common = {"sourceUrl": "https://example.com/local-fixture", "title": "迁移脚本合成验证", "paperClass": "resume-show-new yu-1685547340318179330", "paperStyle": {"width": "689px", "fontSize": "12px", "lineHeight": "22px", "marginLeft": "30px", "marginRight": "30px"}, "profile": [{"key": "name", "text": "合成示例"}], "modules": [{"type": "project", "title": "项目经历", "items": [{"index": 0, "html": html}]}]}
        first = {**common, "channel": "form", "photoUrl": "https://example.com/not-fetched.png"}
        raw = '\ufeff@[name](合成示例)\r\n\r\n:::skill\r\n- **原样空格**  \r\n:::\r\n'
        second = {**common, "channel": "markdown", "paperStyle": {"width": "700px", "fontSize": "13px", "lineHeight": "20px"}, "markdownSource": raw}
        for index, source in enumerate([first, second], 1):
            (directory / f"source-{index}.json").write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
        summary, notes = migrate(directory, directory, node, {})
        assert summary["documentCount"] == 2 and summary["photoCount"] == 1 and not notes
        md = next(directory.glob("*.markdown.md"))
        assert md.read_bytes() == raw.encode("utf-8"), "BOM/CRLF/trailing spaces changed"
        documents = json.loads(next(directory.glob("*.documents.json")).read_text(encoding="utf-8"))
        assert documents[0]["editorMode"] == "visual" and documents[1]["editorMode"] == "markdown"
        assert documents[0]["sections"][0]["items"][0]["title"] == "测试项目"
        assert documents[0]["sections"][0]["items"][0]["startDate"] == "2024.01 ~ 至今"
        assert documents[0]["id"] != documents[1]["id"]
        print("Self-test passed: HTML formatting/nested lists, fresh IDs, local photo bytes, exact Markdown BOM/CRLF/spaces, application ZIP export/import")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input-dir", type=Path, default=ROOT / "output/migration")
    parser.add_argument("--output-dir", type=Path, help="Defaults to the input directory; never public/src/dist")
    parser.add_argument("--photo", action="append", default=[], metavar="SOURCE-STEM=LOCAL-FILE")
    parser.add_argument("--node", help="Existing Node executable; also accepts NODE_BINARY environment variable")
    parser.add_argument("--allow-missing-photo", action="store_true", help="Explicitly generate a backup without unavailable portraits")
    parser.add_argument("--self-test", action="store_true", help="Use synthetic fixtures only and delete them after real ZIP round-trip validation")
    args = parser.parse_args()
    node = node_binary(args.node)
    try:
        if args.self_test:
            self_test(node)
            return
        photos = {}
        for item in args.photo:
            if "=" not in item:
                parser.error("--photo must be SOURCE-STEM=LOCAL-FILE")
            key, value = item.split("=", 1)
            photos[key] = value
        summary, notes = migrate(args.input_dir, args.output_dir or args.input_dir, node, photos, args.allow_missing_photo)
        print(json.dumps({"zip": summary["zip"], "documents": summary["documentCount"], "photos": summary["photoCount"], "markdownBackups": len(summary["markdownFiles"]), "reviewNotes": len(notes) + len(summary["warnings"]), "zipImportVerified": True}, ensure_ascii=False, indent=2))
    except (ValueError, RuntimeError, OSError, AssertionError) as error:
        parser.exit(1, f"Migration stopped: {error}\n")


if __name__ == "__main__":
    main()
