"""Type-IV print sheet layout helpers.

Pure helpers extracted from `src.routes.kids` Phase 2 refactor.
"""
import json
import math

from src.routes.kids_constants import (
    DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE,
    MAX_TYPE_IV_PRINT_CANVAS_VERSION,
    MAX_TYPE_IV_PRINT_CELL_DIMENSION,
    MAX_TYPE_IV_PRINT_CELL_OFFSET,
    MAX_TYPE_IV_PRINT_SAMPLE_ANSWER_LENGTH,
    MAX_TYPE_IV_PRINT_SAMPLE_PROMPT_LENGTH,
    TYPE_IV_PRINT_SHEET_LAYOUT_VERSION,
    TYPE_IV_PRINT_SHEET_MAX_INLINE_FONT_SCALE,
    TYPE_IV_PRINT_SHEET_MAX_REPEAT_COUNT,
    TYPE_IV_PRINT_SHEET_MAX_ROW_PROBLEMS,
    TYPE_IV_PRINT_SHEET_MAX_SCALE,
    TYPE_IV_PRINT_SHEET_MIN_INLINE_FONT_SCALE,
    TYPE_IV_PRINT_SHEET_MIN_SCALE,
    TYPE_IV_PRINT_SHEET_PAPER_SIZE_A4,
    TYPE_IV_PRINT_SHEET_PAPER_SIZE_LETTER,
    TYPE_IV_PRINT_SHEET_PAPER_SPECS,
)


def _safe_positive_int_or_none(val):
    """Return a positive int or None."""
    if val is None:
        return None
    try:
        v = int(val)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def normalize_type_iv_print_cell_design(value):
    """Normalize persisted cell-design geometry for one type-IV deck."""
    if not isinstance(value, dict):
        raise ValueError('cellDesign must be an object')

    def _normalize_int(field_name, *, minimum=0, maximum=MAX_TYPE_IV_PRINT_CELL_DIMENSION):
        raw_value = value.get(field_name)
        try:
            parsed = int(raw_value)
        except (TypeError, ValueError):
            raise ValueError(f'{field_name} must be an integer')
        if parsed < minimum or parsed > maximum:
            raise ValueError(f'{field_name} must be between {minimum} and {maximum}')
        return parsed

    cell_width = _normalize_int('cellWidth', minimum=1, maximum=MAX_TYPE_IV_PRINT_CELL_DIMENSION)
    cell_height = _normalize_int('cellHeight', minimum=1, maximum=MAX_TYPE_IV_PRINT_CELL_DIMENSION)
    content_offset_x = _normalize_int(
        'contentOffsetX',
        minimum=0,
        maximum=MAX_TYPE_IV_PRINT_CELL_OFFSET,
    )
    content_offset_y = _normalize_int(
        'contentOffsetY',
        minimum=0,
        maximum=MAX_TYPE_IV_PRINT_CELL_OFFSET,
    )
    canvas_version = _normalize_int(
        'canvasVersion',
        minimum=1,
        maximum=MAX_TYPE_IV_PRINT_CANVAS_VERSION,
    )

    sample_problem = value.get('sampleProblem')
    if sample_problem is None:
        sample_problem = {}
    if not isinstance(sample_problem, dict):
        raise ValueError('sampleProblem must be an object')

    sample_prompt = str(sample_problem.get('prompt') or '').strip()
    sample_answer = str(sample_problem.get('answer') or '').strip()
    if len(sample_prompt) > MAX_TYPE_IV_PRINT_SAMPLE_PROMPT_LENGTH:
        raise ValueError(
            f'sampleProblem.prompt is too long (max {MAX_TYPE_IV_PRINT_SAMPLE_PROMPT_LENGTH})'
        )
    if len(sample_answer) > MAX_TYPE_IV_PRINT_SAMPLE_ANSWER_LENGTH:
        raise ValueError(
            f'sampleProblem.answer is too long (max {MAX_TYPE_IV_PRINT_SAMPLE_ANSWER_LENGTH})'
        )

    return {
        'cell_width': cell_width,
        'cell_height': cell_height,
        'content_offset_x': content_offset_x,
        'content_offset_y': content_offset_y,
        'canvas_version': canvas_version,
        'sample_problem': (
            {
                'prompt': sample_prompt,
                'answer': sample_answer,
            }
            if sample_prompt or sample_answer
            else None
        ),
    }


def normalize_type_iv_print_sheet_row_scale(value):
    """Normalize one persisted custom-sheet row scale."""
    try:
        parsed = round(float(value), 1)
    except (TypeError, ValueError):
        raise ValueError('row scale must be a number')
    if not math.isfinite(parsed):
        raise ValueError('row scale must be finite')
    if parsed < TYPE_IV_PRINT_SHEET_MIN_SCALE or parsed > TYPE_IV_PRINT_SHEET_MAX_SCALE:
        raise ValueError(
            f'row scale must be between {TYPE_IV_PRINT_SHEET_MIN_SCALE} and {TYPE_IV_PRINT_SHEET_MAX_SCALE}'
        )
    return parsed


def normalize_type_iv_print_sheet_inline_font_scale(value):
    """Normalize one inline-row font scale."""
    if value in (None, ''):
        return 1.0
    try:
        parsed = round(float(value), 1)
    except (TypeError, ValueError):
        raise ValueError('inlineFontScale must be a number')
    if not math.isfinite(parsed):
        raise ValueError('inlineFontScale must be finite')
    if (
        parsed < TYPE_IV_PRINT_SHEET_MIN_INLINE_FONT_SCALE
        or parsed > TYPE_IV_PRINT_SHEET_MAX_INLINE_FONT_SCALE
    ):
        raise ValueError(
            'inlineFontScale must be between '
            f'{TYPE_IV_PRINT_SHEET_MIN_INLINE_FONT_SCALE} and '
            f'{TYPE_IV_PRINT_SHEET_MAX_INLINE_FONT_SCALE}'
        )
    return parsed


def normalize_type_iv_print_sheet_rows(value, layout_format='vertical'):
    """Normalize one custom math-sheet row list from the builder."""
    if not isinstance(value, list):
        raise ValueError('rows must be an array')
    normalized_rows = []
    for index, item in enumerate(list(value)):
        if not isinstance(item, dict):
            raise ValueError(f'rows[{index}] must be an object')
        shared_deck_id = _safe_positive_int_or_none(item.get('sharedDeckId'))
        if not shared_deck_id:
            raise ValueError(f'rows[{index}].sharedDeckId is required')
        row = {
            'shared_deck_id': int(shared_deck_id),
            'scale': normalize_type_iv_print_sheet_row_scale(item.get('scale', 1)),
        }
        if layout_format == 'inline':
            inline_w = _safe_positive_int_or_none(item.get('inlineCellWidth'))
            inline_h = _safe_positive_int_or_none(item.get('inlineCellHeight'))
            inline_col = _safe_positive_int_or_none(item.get('colCount'))
            if not inline_w or not inline_h or not inline_col:
                raise ValueError(f'rows[{index}] missing inline cell dimensions')
            row['inline_cell_width'] = int(inline_w)
            row['inline_cell_height'] = int(inline_h)
            row['col_count'] = int(inline_col)
            row['inline_font_scale'] = normalize_type_iv_print_sheet_inline_font_scale(
                item.get('inlineFontScale')
            )
        normalized_rows.append(row)
    if not normalized_rows:
        raise ValueError('rows must include at least one row')
    return normalized_rows


def normalize_type_iv_print_sheet_repeat_count(value):
    """Normalize one persisted custom-sheet repeat count."""
    if value in (None, ''):
        return 1
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError('repeatCount must be an integer')
    if parsed < 1:
        raise ValueError('repeatCount must be at least 1')
    if parsed > TYPE_IV_PRINT_SHEET_MAX_REPEAT_COUNT:
        raise ValueError(
            f'repeatCount must be at most {TYPE_IV_PRINT_SHEET_MAX_REPEAT_COUNT}'
        )
    return parsed


def normalize_type_iv_print_sheet_paper_size(
    value,
    *,
    default=DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE,
):
    """Normalize one persisted custom-sheet paper size."""
    raw_value = str(value or '').strip().lower()
    if not raw_value:
        return str(default or DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE)
    if raw_value in {
        TYPE_IV_PRINT_SHEET_PAPER_SIZE_A4,
        '8.27x11.69',
        '8.27×11.69',
        '210x297',
    }:
        return TYPE_IV_PRINT_SHEET_PAPER_SIZE_A4
    if raw_value in {
        TYPE_IV_PRINT_SHEET_PAPER_SIZE_LETTER,
        'us_letter',
        'us-letter',
        'us letter',
        '8.5x11',
        '8.5×11',
        '8.50x11.00',
    }:
        return TYPE_IV_PRINT_SHEET_PAPER_SIZE_LETTER
    raise ValueError('paperSize must be "letter" or "a4"')


def get_type_iv_print_sheet_paper_spec(
    paper_size,
    *,
    default=DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE,
):
    """Return one normalized custom-sheet paper spec."""
    normalized_size = normalize_type_iv_print_sheet_paper_size(
        paper_size,
        default=default,
    )
    spec = dict(TYPE_IV_PRINT_SHEET_PAPER_SPECS.get(normalized_size) or {})
    if not spec:
        raise ValueError('paperSize must be "letter" or "a4"')
    spec['key'] = normalized_size
    return spec


def build_shared_deck_print_cell_design(raw_payload):
    """Build normalized print cell design payload from stored JSON text."""
    if raw_payload in (None, ''):
        return None
    if isinstance(raw_payload, dict):
        payload = raw_payload
    else:
        try:
            payload = json.loads(str(raw_payload))
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    if not isinstance(payload, dict):
        return None

    try:
        cell_width = int(payload.get('cell_width'))
        cell_height = int(payload.get('cell_height'))
    except (TypeError, ValueError):
        return None

    sample_problem = payload.get('sample_problem')
    if not isinstance(sample_problem, dict):
        sample_problem = {}
    prompt = str(sample_problem.get('prompt') or '').strip()
    answer = str(sample_problem.get('answer') or '').strip()
    return {
        'cell_width': cell_width,
        'cell_height': cell_height,
        'content_offset_x': int(payload.get('content_offset_x') or 0),
        'content_offset_y': int(payload.get('content_offset_y') or 0),
        'canvas_version': int(payload.get('canvas_version')) if payload.get('canvas_version') is not None else None,
        'sample_problem': (
            {
                'prompt': prompt,
                'answer': answer,
            }
            if prompt or answer
            else None
        ),
    }


def get_type_iv_print_sheet_row_metrics(cell_design, scale, paper_size=DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE):
    """Return one persisted custom-sheet row's derived dimensions."""
    if not isinstance(cell_design, dict):
        raise ValueError('row cell design is missing')
    paper_spec = get_type_iv_print_sheet_paper_spec(
        paper_size,
        default=DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE,
    )
    try:
        cell_width = int(cell_design.get('cell_width'))
        cell_height = int(cell_design.get('cell_height'))
    except (TypeError, ValueError):
        raise ValueError('row cell design is invalid')
    if cell_width <= 0 or cell_height <= 0:
        raise ValueError('row cell design is invalid')
    scaled_width = int(math.ceil(float(cell_width) * float(scale)))
    scaled_height = int(math.ceil(float(cell_height) * float(scale)))
    if scaled_width <= 0 or scaled_height <= 0:
        raise ValueError('row scale is invalid')
    col_count = max(1, int(math.floor(float(paper_spec['box_width']) / scaled_width)))
    if col_count > TYPE_IV_PRINT_SHEET_MAX_ROW_PROBLEMS:
        raise ValueError(
            f'row produces too many problems ({col_count}); make the card wider before building'
        )
    return {
        'scaled_width': scaled_width,
        'scaled_height': scaled_height,
        'col_count': col_count,
    }


def build_type_iv_print_sheet_layout_payload(
    rows,
    deck_rows_by_id,
    definitions_by_id,
    layout_format='vertical',
    repeat_count=1,
    paper_size=DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE,
):
    """Build persisted custom-sheet layout JSON from builder rows."""
    paper_spec = get_type_iv_print_sheet_paper_spec(paper_size)
    used_height = 0.0
    layout_rows = []
    for index, row in enumerate(list(rows or [])):
        shared_deck_id = int(row.get('shared_deck_id') or 0)
        if shared_deck_id <= 0:
            raise ValueError(f'rows[{index}] has an invalid deck id')
        deck_info = deck_rows_by_id.get(shared_deck_id)
        if not deck_info:
            raise ValueError(f'rows[{index}] references a deck outside this category')
        display_name = str(deck_info.get('representative_front') or deck_info.get('name') or '').strip()
        if not display_name:
            display_name = f'Deck {shared_deck_id}'

        if layout_format == 'inline':
            inline_w = int(row.get('inline_cell_width') or 0)
            inline_h = int(row.get('inline_cell_height') or 0)
            col_count = int(row.get('col_count') or 0)
            inline_font_scale = normalize_type_iv_print_sheet_inline_font_scale(
                row.get('inline_font_scale')
            )
            if inline_w <= 0 or inline_h <= 0 or col_count <= 0:
                raise ValueError(f'rows[{index}] has invalid inline dimensions')
            layout_rows.append({
                'shared_deck_id': shared_deck_id,
                'deck_name': display_name,
                'scale': 1,
                'inline_font_scale': inline_font_scale,
                'col_count': col_count,
                'cell_design': {
                    'cell_width': inline_w,
                    'cell_height': inline_h,
                    'content_offset_x': 0,
                    'content_offset_y': 0,
                    'canvas_version': 0,
                },
            })
        else:
            definition = definitions_by_id.get(shared_deck_id) or {}
            cell_design = build_shared_deck_print_cell_design(definition.get('cell_design'))
            if not cell_design:
                raise ValueError(
                    f'"{str(deck_info.get("representative_front") or deck_info.get("name") or shared_deck_id)}" '
                    'does not have a saved cell design'
                )
            scale = normalize_type_iv_print_sheet_row_scale(row.get('scale', 1))
            metrics = get_type_iv_print_sheet_row_metrics(
                cell_design,
                scale,
                paper_size=paper_spec['key'],
            )
            used_height += metrics['scaled_height']
            if used_height > float(paper_spec['safe_grid_height']) + 0.001:
                raise ValueError('This sheet does not fit on one printable page')
            layout_rows.append({
                'shared_deck_id': shared_deck_id,
                'deck_name': display_name,
                'scale': scale,
                'col_count': int(metrics['col_count']),
                'cell_design': cell_design,
            })
    if not layout_rows:
        raise ValueError('rows must include at least one row')
    result = {
        'version': TYPE_IV_PRINT_SHEET_LAYOUT_VERSION,
        'paper_size': paper_spec['key'],
        'repeat_count': normalize_type_iv_print_sheet_repeat_count(repeat_count),
        'rows': layout_rows,
    }
    if layout_format == 'inline':
        result['layout_format'] = 'inline'
    return result


def build_type_iv_print_sheet_layout(raw_payload):
    """Parse one persisted custom-sheet layout JSON payload."""
    if raw_payload in (None, ''):
        return None
    if isinstance(raw_payload, dict):
        payload = raw_payload
    else:
        try:
            payload = json.loads(str(raw_payload))
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    if not isinstance(payload, dict):
        return None
    layout_format = str(payload.get('layout_format') or '').strip().lower()
    try:
        paper_size = normalize_type_iv_print_sheet_paper_size(
            payload.get('paper_size'),
            default=DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE,
        )
    except ValueError:
        return None
    paper_spec = get_type_iv_print_sheet_paper_spec(
        paper_size,
        default=DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE,
    )
    raw_rows = payload.get('rows')
    if not isinstance(raw_rows, list):
        return None
    rows = []
    used_height = 0.0
    for raw_row in raw_rows:
        if not isinstance(raw_row, dict):
            return None
        shared_deck_id = _safe_positive_int_or_none(raw_row.get('shared_deck_id'))
        if not shared_deck_id:
            return None
        try:
            scale = normalize_type_iv_print_sheet_row_scale(raw_row.get('scale', 1))
            col_count = int(raw_row.get('col_count'))
        except (TypeError, ValueError):
            return None
        if col_count <= 0 or col_count > TYPE_IV_PRINT_SHEET_MAX_ROW_PROBLEMS:
            return None
        cell_design = build_shared_deck_print_cell_design(raw_row.get('cell_design'))
        if not cell_design:
            return None
        if layout_format == 'inline':
            try:
                inline_font_scale = normalize_type_iv_print_sheet_inline_font_scale(
                    raw_row.get('inline_font_scale')
                )
            except ValueError:
                return None
            rows.append({
                'shared_deck_id': int(shared_deck_id),
                'deck_name': str(raw_row.get('deck_name') or '').strip() or f'Deck {shared_deck_id}',
                'scale': scale,
                'col_count': col_count,
                'cell_design': cell_design,
                'inline_font_scale': inline_font_scale,
            })
            continue
        try:
            metrics = get_type_iv_print_sheet_row_metrics(
                cell_design,
                scale,
                paper_size=paper_spec['key'],
            )
        except ValueError:
            return None
        used_height += metrics['scaled_height']
        if used_height > float(paper_spec['safe_grid_height']) + 0.001:
            return None
        rows.append({
            'shared_deck_id': int(shared_deck_id),
            'deck_name': str(raw_row.get('deck_name') or '').strip() or f'Deck {shared_deck_id}',
            'scale': scale,
            'col_count': col_count,
            'cell_design': cell_design,
        })
    if not rows:
        return None
    try:
        repeat_count = normalize_type_iv_print_sheet_repeat_count(payload.get('repeat_count'))
    except ValueError:
        return None
    result = {
        'version': int(payload.get('version') or TYPE_IV_PRINT_SHEET_LAYOUT_VERSION),
        'paper_size': paper_spec['key'],
        'repeat_count': repeat_count,
        'rows': rows,
    }
    if layout_format and layout_format != 'vertical':
        result['layout_format'] = layout_format
    return result


def build_type_iv_print_sheet_row_seed(seed_base, row_index, shared_deck_id):
    """Derive one deterministic per-row seed from the sheet seed."""
    base = int(seed_base or 0)
    return int((base + ((int(row_index) + 1) * 1_000_003) + (int(shared_deck_id) * 97_307)) % 2_000_000_000)


def build_type_iv_print_sheet_display_number(sheet_id, page_index=0, total_pages=1):
    """Return one user-facing sheet number label, with page suffix when needed."""
    base_id = int(sheet_id or 0)
    page_total = max(1, int(total_pages or 1))
    if page_total <= 1:
        return str(base_id)
    return f'{base_id}.{int(page_index) + 1}'
