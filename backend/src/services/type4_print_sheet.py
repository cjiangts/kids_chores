"""Type-IV print sheet pagination + rendering + record readers.

Pure helpers that:
  - Paginate rendered rows for the printable layout.
  - Build rendered rows from a sheet layout + generator definitions.
  - Read one persisted custom math sheet record.

DB helpers take an open `conn` (per-kid SQLite). No module state.
"""
from src.routes.kids_constants import DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE
from src.type4_generator_preview import run_type4_generator
from src.services.type4_print_layout import (
    build_type_iv_print_sheet_layout,
    build_type_iv_print_sheet_row_seed,
    get_type_iv_print_sheet_paper_spec,
)


def paginate_type_iv_print_sheet_rendered_rows(
    rendered_rows,
    *,
    paper_size=DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE,
    layout_format='vertical',
):
    """Split rendered rows into one or more printable pages."""
    rows = list(rendered_rows or [])
    if not rows:
        return [[]]
    if str(layout_format or 'vertical').strip().lower() != 'inline':
        return [rows]
    paper_spec = get_type_iv_print_sheet_paper_spec(paper_size)
    max_height = float(paper_spec['safe_grid_height'])
    pages = []
    current_page_rows = []
    used_height = 0.0
    for row in rows:
        cell_design = row.get('cell_design') if isinstance(row, dict) else {}
        try:
            row_height = int((cell_design or {}).get('cell_height') or 0)
        except (TypeError, ValueError):
            row_height = 0
        row_height = max(1, row_height)
        if current_page_rows and (used_height + float(row_height)) > max_height + 0.001:
            pages.append(current_page_rows)
            current_page_rows = []
            used_height = 0.0
        current_page_rows.append(row)
        used_height += float(row_height)
    if current_page_rows:
        pages.append(current_page_rows)
    return pages or [[]]


def build_type_iv_print_sheet_rendered_rows(layout_rows, definitions_by_id, seed_base):
    """Render one page of generated math problems from one persisted sheet layout."""
    rendered_rows = []
    for index, row in enumerate(layout_rows):
        shared_deck_id = int(row['shared_deck_id'])
        definition = definitions_by_id.get(shared_deck_id) or {}
        generator_code = str(definition.get('code') or '').strip()
        if not generator_code:
            raise LookupError(f'Generator definition not found for deck {shared_deck_id}')
        row_seed = build_type_iv_print_sheet_row_seed(
            seed_base,
            index,
            shared_deck_id,
        )
        samples = run_type4_generator(
            generator_code,
            sample_count=int(row.get('col_count') or 0),
            seed_base=row_seed,
        )
        problems = [{
            'prompt': str(sample.get('prompt') or ''),
            'answer': str(sample.get('answer') or ''),
        } for sample in samples]
        rendered_rows.append({
            'shared_deck_id': shared_deck_id,
            'deck_name': str(row.get('deck_name') or ''),
            'scale': float(row.get('scale') or 1),
            'inline_font_scale': float(row.get('inline_font_scale') or 1),
            'col_count': int(row.get('col_count') or 0),
            'cell_design': row.get('cell_design'),
            'problems': problems,
        })
    return rendered_rows


def get_type_iv_print_sheet_record(conn, sheet_id):
    """Return one persisted custom math sheet by id."""
    row = conn.execute(
        """
        SELECT id, category_key, layout_json, seed_base, status, incorrect_count, created_at, completed_at
        FROM type4_print_sheets
        WHERE id = ?
        LIMIT 1
        """,
        [sheet_id],
    ).fetchone()
    if not row:
        return None
    layout = build_type_iv_print_sheet_layout(row[2])
    return {
        'id': int(row[0]),
        'category_key': str(row[1] or '').strip().lower(),
        'layout': layout,
        'repeat_count': int((layout or {}).get('repeat_count') or 1),
        'seed_base': int(row[3] or 0),
        'status': str(row[4] or '').strip().lower(),
        'incorrect_count': int(row[5]) if row[5] is not None else None,
        'created_at': row[6].isoformat() if row[6] else None,
        'completed_at': row[7].isoformat() if row[7] else None,
    }
