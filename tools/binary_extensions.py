"""Binary file extensions to skip for text-based operations.

These files can't be meaningfully compared as text and are often large.
Ported from free-code src/constants/files.ts.
"""

BINARY_EXTENSIONS = frozenset({
    # Images
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff", ".tif",
    # Videos
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv", ".flv", ".m4v", ".mpeg", ".mpg",
    # Audio
    ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".aiff", ".opus",
    # Archives
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz", ".z", ".tgz", ".iso",
    # Executables/binaries
    ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".obj", ".lib",
    ".app", ".msi", ".deb", ".rpm",
    # Documents (exclude .pdf — text-based, agents may want to inspect)
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".odt", ".ods", ".odp",
    # Fonts
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
    # Bytecode / VM artifacts
    ".pyc", ".pyo", ".class", ".jar", ".war", ".ear", ".node", ".wasm", ".rlib",
    # Database files
    ".sqlite", ".sqlite3", ".db", ".mdb", ".idx",
    # Design / 3D
    ".psd", ".ai", ".eps", ".sketch", ".fig", ".xd", ".blend", ".3ds", ".max",
    # Flash
    ".swf", ".fla",
    # Lock/profiling data
    ".lockb", ".dat", ".data",
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


def has_binary_extension(path: str) -> bool:
    """Check if a file path has a binary extension. Pure string check, no I/O."""
    dot = path.rfind(".")
    if dot == -1:
        return False
    return path[dot:].lower() in BINARY_EXTENSIONS
