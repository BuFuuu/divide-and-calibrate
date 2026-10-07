"""Parse a block of text (typically a step's output) into discrete step items."""
import re


def parse_steps(text: str) -> list[str]:
    items = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^\s*\d+[.)]\s*(.+)$", line)
        if m:
            items.append(m.group(1).strip())
        elif line.startswith(("-", "*")):
            items.append(line[1:].strip())
    if items:
        return items

    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if len(lines) > 1:
        return lines

    raise ValueError(
        "No steps found: looked for numbered items (\"1.\"), "
        "\"-\"/\"*\" bullets, or multiple newline-separated lines in the output."
    )
