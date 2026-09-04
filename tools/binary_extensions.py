"""Binary file extensions to skip for text-based operations (ported from
free-code src/constants/files.ts)."""

# Images, video, audio, archives, executables, documents (.pdf deliberately
# excluded — text-based, agents may want to inspect), fonts, bytecode/VM,
# databases, design/3D, Flash, lock/profiling data.
BINARY_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff", ".tif",
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv", ".flv", ".m4v", ".mpeg", ".mpg",
    ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".aiff", ".opus",
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz", ".z", ".tgz", ".iso",
    ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".obj", ".lib", ".app", ".msi", ".deb", ".rpm",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
    ".pyc", ".pyo", ".class", ".jar", ".war", ".ear", ".node", ".wasm", ".rlib",
    ".sqlite", ".sqlite3", ".db", ".mdb", ".idx",
    ".psd", ".ai", ".eps", ".sketch", ".fig", ".xd", ".blend", ".3ds", ".max",
    ".swf", ".fla", ".lockb", ".dat", ".data",
})

# Known plain-text / source / structured-data extensions. Files with these
# extensions are ALWAYS treated as text so read_file pulls the real content
# even when multi-byte UTF-8 (e.g. CJK) gets byte-truncated by the sampler
# into a stray U+FFFD, which would otherwise be misdetected as binary and
# cause the read to be skipped. The U+FFFD hardening in
# tools/file_operations.py only applies to unknown / no-extension files,
# where a replacement char genuinely signals corruption risk.
TEXT_EXTENSIONS = frozenset({
    # Markup / docs
    ".md", ".markdown", ".txt", ".text", ".rst", ".adoc", ".asciidoc",
    # Data / config
    ".json", ".jsonl", ".json5", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".conf", ".config", ".properties", ".xml", ".csv", ".tsv",
    # Web
    ".html", ".htm", ".svg", ".css", ".scss", ".less", ".vue", ".svelte",
    # Source (general)
    ".py", ".pyi", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".c", ".h",
    ".cpp", ".cc", ".hpp", ".hxx", ".cs", ".java", ".kt", ".kts", ".go",
    ".rs", ".rb", ".php", ".pl", ".pm", ".lua", ".sql", ".r", ".sh", ".bash",
    ".zsh", ".fish", ".ps1", ".bat", ".cmd", ".psm1",
    # Misc text-ish
    ".log", ".tex", ".bib", ".proto", ".graphql", ".gql", ".tf", ".tfvars",
    ".gradle", ".mk", ".cmake", ".rss", ".atom",
})

# Container documents (OOXML/ODF/EPUB zips, OLE, RTF) a plain-text write can
# NEVER produce validly: read_file auto-extracts them, so writing the text back
# via write_file/patch silently destroys the document. PDF is deliberately
# absent — raw PDF syntax is text-authorable, so only overwrites are dangerous
# (the write guard handles that via is_pdf_path).
OPAQUE_DOCUMENT_EXTENSIONS = frozenset({
    ".doc", ".docx", ".docm", ".xls", ".xlsx", ".xlsm", ".xlsb",
    ".ppt", ".pps", ".pot", ".pptx", ".pptm", ".ppsx", ".ppsm",
    ".odt", ".ods", ".odp", ".rtf", ".epub",
})


def _has_extension_in(path: str, extensions: frozenset) -> bool:
    """Case-insensitive check on the final ``.suffix``; pure string, no I/O."""
    dot = path.rfind(".")
    return dot != -1 and path[dot:].lower() in extensions


def has_binary_extension(path: str) -> bool:
    return _has_extension_in(path, BINARY_EXTENSIONS)


def has_opaque_document_extension(path: str) -> bool:
    return _has_extension_in(path, OPAQUE_DOCUMENT_EXTENSIONS)


def is_pdf_path(path: str) -> bool:
    return path.lower().endswith(".pdf")