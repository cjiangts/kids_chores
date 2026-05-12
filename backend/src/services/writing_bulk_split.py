"""Bulk-text splitters for writing / type-II inputs.

Pure helpers that parse raw multi-line user input into deduped tokens
or (front, back) row tuples. Chinese-aware paths preserve Chinese phrase
chunks separated by non-Chinese characters; non-Chinese paths split on
whitespace or commas. No DB or module state.
"""
import re


def split_writing_bulk_text(raw_text):
    """Split bulk writing input by non-Chinese chars, preserving Chinese phrase chunks."""
    text = str(raw_text or '')
    # Match contiguous Chinese runs; separators are any non-Chinese chars.
    chunks = re.findall(r'[\u3400-\u9FFF\uF900-\uFAFF]+', text)
    deduped = []
    seen = set()
    for chunk in chunks:
        token = chunk.strip()
        if not token or token in seen:
            continue
        deduped.append(token)
        seen.add(token)
    return deduped


def split_type2_bulk_rows(raw_text, has_chinese_specific_logic):
    """Split bulk type-II input into (front, back) rows."""
    text = str(raw_text or '')
    if bool(has_chinese_specific_logic):
        text = text.replace('\uff0c', ',')
    non_empty_lines = [
        str(raw or '').strip()
        for raw in text.splitlines()
        if str(raw or '').strip()
    ]
    if not non_empty_lines:
        return []

    has_csv = any(',' in line for line in non_empty_lines)
    has_blob = any(',' not in line for line in non_empty_lines)
    if has_csv and has_blob:
        raise ValueError(
            'Mixed formats are not allowed. Use either "prompt, word" on every line '
            'or a word blob with no commas — not both.'
        )

    if bool(has_chinese_specific_logic):
        if has_csv:
            rows = []
            seen_back = set()
            for line in non_empty_lines:
                parts = line.split(',', 1)
                front = str(parts[0] or '').strip()
                back = str(parts[1] or '').strip()
                if not back:
                    back = front
                if not front or not back or back in seen_back:
                    continue
                seen_back.add(back)
                rows.append((front, back))
            return rows
        tokens = split_writing_bulk_text(raw_text)
        return [(token, token) for token in tokens]

    rows = []
    seen_front = set()
    for line in non_empty_lines:
        if has_csv:
            parts = line.split(',', 1)
            front = str(parts[0] or '').strip()
            back = str(parts[1] or '').strip()
            if not back:
                back = front
            if not front or front in seen_front:
                continue
            seen_front.add(front)
            rows.append((front, back))
        else:
            for token in line.split():
                tok = str(token or '').strip()
                if not tok or tok in seen_front:
                    continue
                seen_front.add(tok)
                rows.append((tok, tok))
    return rows
