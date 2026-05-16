"""Kid management API routes — package entrypoint.

Layout (search for `# ===` markers to jump between sections):

    1. Imports (stdlib, services, sibling-route-module helpers)
    2. Module state — `_SHARED_DECK_MUTATION_LOCK` + small helpers
    3. Shared-deck scope dispatch — scope/op constants + CATEGORY_CONFIG
    4. Type-specific cards handlers — `get_shared_type<N>_cards`
    5. Request-parsing helpers — Flask `request.*` extractors
    6. Scope-management context resolvers — kid + raw-key → context dict
    7. Per-scope route handlers — `*_for_scope(kid_id, category, ...)`
    8. Operation dispatch table — `SHARED_DECK_OPERATION_HANDLERS`
    9. CATEGORY_CONFIG wiring — final scope → config map
   10. Re-exports + sibling-route-module loads

Most logic now lives in `src/services/*`; this file holds Flask-level
plumbing (auth, request parsing, response framing, mutation lock) and
the dispatch table that wires URL scopes to handlers.
"""
from flask import Blueprint, request, jsonify, send_from_directory, send_file
from datetime import datetime, timezone
from collections import defaultdict
import json
import os
import shutil
import subprocess
import uuid
import time
import threading
import mimetypes
from io import BytesIO
from werkzeug.utils import secure_filename
from src.badges.session_sync import sync_badges_after_session_complete
from src.chinese_character_meanings import (
    get_character_bank_pinyin,
    is_chinese_text,
    is_single_chinese_character,
)
from src.db import metadata, kid_db
from src.db.shared_deck_db import get_shared_decks_connection
from src.type4_generator_preview import preview_type4_generator, run_type4_generator, test_type4_validate
from src.routes.kids_constants import *  # noqa: F401,F403

kids_bp = Blueprint('kids', __name__)

from src.services.card_stats import (
    get_card_ids_practiced_for_category,
    get_cards_with_stats_for_card_ids,
    get_cards_with_stats_for_deck_ids,
    map_card_row,
)
from src.services.writing_candidates import (
    get_pending_writing_card_ids,
    get_writing_candidate_rows,
)
from src.services.practice_session import build_special_session_ready_payload
from src.services.shared_deck_queries import (
    find_shared_type_iv_representative_label_conflict,
    get_allowed_shared_deck_first_tags,
    get_kid_materialized_shared_decks_by_first_tag,
    get_shared_deck_behavior_type_from_raw_tags,
    get_shared_deck_cards,
    get_shared_deck_owned_by_family,
    get_shared_deck_rows_by_first_tag,
    get_shared_type_iv_deck_rows,
    is_shared_deck_chinese_type_i,
)

# ====================================================================
# 2. Module state
#   `_SHARED_DECK_MUTATION_LOCK` serializes opt-in/opt-out across kids
#   (acquired by handlers below before mutating per-kid DBs).
# ====================================================================

_SHARED_DECK_MUTATION_LOCK = threading.RLock()


def get_family_root(family_id):
    """Return filesystem root for one family."""
    return os.path.join(FAMILIES_ROOT, f'family_{family_id}')


def encode_retry_recovered_session_result(existing_retry_count):
    """Return the negative correct value for a card fixed in the next retry round."""
    retry_count = max(0, int(existing_retry_count or 0))
    return -(retry_count + 2)


from src.services.writing_audio import (
    build_shared_type1_prompt_audio_file_name,
    build_shared_writing_audio_file_name,
    build_type_i_chinese_prompt_audio_payload,
    build_writing_front_tts_text,
    build_writing_prompt_audio_payload,
    cleanup_type3_pending_audio_files_by_payload,
    cleanup_uncommitted_type3_audio,
    ensure_type3_audio_dir,
    format_type2_bulk_card_text,
    get_kid_type3_audio_dir,
    get_shared_writing_audio_dir,
    normalize_writing_audio_text,
    synthesize_shared_writing_audio,
)
from src.services.family_auth import (
    get_kid_connection_for,
    get_kid_for_family,
)


from src.services.shared_deck_normalize import (
    build_shared_deck_tags,
    dedupe_shared_deck_cards_by_front,
    extract_shared_deck_tags_and_labels,
    format_shared_deck_tag_display_label,
    normalize_deck_category_keys,
    normalize_optional_bool,
    normalize_optional_display_name,
    normalize_shared_deck_cards,
    normalize_shared_deck_category_behavior,
    normalize_shared_deck_fronts,
    normalize_shared_deck_ids,
    normalize_shared_deck_tag,
    normalize_type_iv_daily_counts_payload,
    normalize_type_iv_display_label,
    normalize_type_iv_generator_code,
    normalize_type_iv_multichoice_only,
    parse_shared_deck_tag_with_comment,
    sanitize_deck_mix_payload,
)
from src.services.shared_deck_category import (
    get_session_behavior_type,
    get_shared_deck_category_meta_by_key,
)
from src.services.type4_print_layout import (
    _safe_positive_int_or_none,
    build_type_iv_print_sheet_display_number,
    build_type_iv_print_sheet_layout,
    build_type_iv_print_sheet_layout_payload,
    normalize_type_iv_print_cell_design,
    normalize_type_iv_print_sheet_paper_size,
    normalize_type_iv_print_sheet_repeat_count,
    normalize_type_iv_print_sheet_rows,
)



from src.services.shared_deck_materialize import sync_materialized_shared_deck_metadata_for_all_kids


from src.services.kid_category_config import (
    get_category_drill_speed_cutoff_ms_for_kid,
    get_category_include_orphan_for_kid,
    get_category_orphan_deck,
    get_category_orphan_deck_name,
    get_category_session_card_count_for_kid,
    get_or_create_category_orphan_deck,
    get_orphan_deck,
    hydrate_kid_category_config_from_db,
    with_preview_session_count_for_category,
)


from src.services.deck_source_merge import get_shared_merged_source_decks_for_kid

from src.services.practice_priority import build_practice_priority_preview_for_decks
from src.services.chinese_text import get_category_chinese_back_content
from src.services.kid_daily_progress import (
    build_kid_daily_progress_section,
    get_deck_category_display_name,
)
from src.services.kid_category_resolve import (
    resolve_kid_type_i_category_with_mode,
    resolve_kid_type_ii_category_with_mode,
    resolve_kid_type_iii_category_with_mode,
    resolve_kid_type_iv_category_with_mode,
)
from src.services.shared_deck_optin import (
    opt_in_shared_decks_internal,
    opt_in_type_i_shared_decks,
    opt_in_type_iv_shared_decks,
    opt_out_shared_decks_internal,
)
from src.services.shared_deck_payloads import (
    build_merged_source_decks_payload,
    build_shared_decks_listing_payload,
    build_type_i_shared_cards_payload,
    build_type_i_shared_decks_payload,
    build_type_iv_shared_cards_payload,
    build_type_iv_shared_decks_payload,
    build_type_iv_special_session_ready_payload,
    get_type_iv_practice_source_rows,
)
from src.services.shared_card_skip import (
    update_shared_card_skip_internal,
    update_shared_cards_skip_bulk_internal,
)
from src.services.writing_bulk_split import split_type2_bulk_rows


# ====================================================================
# 3. Shared-deck scope dispatch
#   Every /kids/<id>/<scope>/... route flows through the dispatcher
#   below. SHARED_DECK_SCOPE_* are URL segments; SHARED_DECK_OP_* are
#   logical operations; CATEGORY_CONFIG (built at end of module) maps
#   each scope to its behavior kind and per-scope handlers.
# ====================================================================

SHARED_DECK_SCOPE_TYPE1 = 'cards'
SHARED_DECK_SCOPE_TYPE3 = 'lesson-reading'
SHARED_DECK_SCOPE_TYPE2 = 'type2'
SHARED_DECK_SCOPE_TYPE4 = 'type4'

SHARED_DECK_OP_GET = 'shared_decks_get'
SHARED_DECK_OP_OPT_IN = 'shared_decks_opt_in'
SHARED_DECK_OP_OPT_OUT = 'shared_decks_opt_out'
SHARED_DECK_OP_GET_CARDS = 'shared_decks_get_cards'
SHARED_DECK_OP_SKIP_UPDATE = 'shared_decks_skip_update'
SHARED_DECK_OP_SKIP_UPDATE_BULK = 'shared_decks_skip_update_bulk'
SHARED_DECK_OP_GET_DECKS = 'decks_get'
SHARED_DECK_OP_CARD_SEARCH_INDEX = 'shared_decks_card_search_index'

CATEGORY_CONFIG = {}


def normalize_shared_deck_scope(raw_scope):
    """Normalize one shared-deck route scope segment."""
    return str(raw_scope or '').strip().lower().replace('_', '-')


def get_shared_deck_category_config(raw_scope):
    """Resolve one shared-deck scope to category config."""
    scope = normalize_shared_deck_scope(raw_scope)
    if not scope:
        return None
    return CATEGORY_CONFIG.get(scope)


def dispatch_shared_deck_scope_operation(scope, operation, kid_id, card_id=None):
    """Dispatch one shared-deck route operation by scope."""
    category = get_shared_deck_category_config(scope)
    if category is None:
        return jsonify({'error': 'Unknown shared-deck scope'}), 404
    return run_shared_deck_scope_operation(operation, kid_id, category, card_id=card_id)


# ====================================================================
# 4. Type-specific cards handlers
#   Each scope has a dedicated `get_shared_type<N>_cards(kid_id)` that
#   wires up category resolution + payload assembly. CATEGORY_CONFIG
#   below maps each scope to its handler.
# ====================================================================

def get_shared_type1_cards(kid_id):
    """Get merged cards across opted-in type-I decks and orphan deck."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        conn = get_kid_connection_for(kid, read_only=True)
        try:
            category_key, _ = resolve_kid_type_i_category_with_mode(
                kid,
                request.args.get('categoryKey'),
                conn=conn,
            )
            payload = build_type_i_shared_cards_payload(
                kid,
                category_key,
                include_practiced_from_other=parse_include_practiced_from_other_arg(),
                conn=conn,
            )
            payload.update(build_kid_daily_progress_section(kid, category_key, conn=conn))
        finally:
            conn.close()
        return jsonify(payload), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ====================================================================
# 5. Request-parsing helpers (Flask `request.args` / `request.get_json()`)
# ====================================================================

def parse_include_practiced_from_other_arg():
    """Return True when the request opts into including practiced-but-not-opted-in cards."""
    raw = str(request.args.get('includePracticedFromOther') or '').strip().lower()
    return raw in {'1', 'true', 'yes', 'on'}


def parse_shared_card_skip_update_request(card_id):
    """Parse shared-card skip update payload and return (card_id_int, skipped)."""
    try:
        card_id_int = int(card_id)
    except (TypeError, ValueError):
        raise ValueError('Invalid card id') from None

    payload = request.get_json() or {}
    if 'skipped' not in payload or not isinstance(payload.get('skipped'), bool):
        raise ValueError('skipped must be a boolean')
    skipped = bool(payload.get('skipped'))
    return card_id_int, skipped


def parse_shared_card_skip_bulk_update_request():
    """Parse shared-card bulk skip update payload and return (card_ids, skipped)."""
    payload = request.get_json() or {}
    raw_card_ids = payload.get('card_ids')
    if raw_card_ids is None:
        raw_card_ids = payload.get('cardIds')
    if not isinstance(raw_card_ids, list) or not raw_card_ids:
        raise ValueError('card_ids must be a non-empty list')
    if len(raw_card_ids) > 2000:
        raise ValueError('card_ids list is too large')
    card_ids = []
    seen = set()
    for raw_id in raw_card_ids:
        try:
            card_id_int = int(raw_id)
        except (TypeError, ValueError):
            raise ValueError('card_ids must contain integers') from None
        if card_id_int in seen:
            continue
        seen.add(card_id_int)
        card_ids.append(card_id_int)
    if not card_ids:
        raise ValueError('card_ids must contain at least one valid id')
    if 'skipped' not in payload or not isinstance(payload.get('skipped'), bool):
        raise ValueError('skipped must be a boolean')
    skipped = bool(payload.get('skipped'))
    return card_ids, skipped




def parse_shared_deck_ids_from_request_payload(payload):
    """Parse shared deck ids from either deck_ids or deckIds payload key."""
    data = payload if isinstance(payload, dict) else {}
    raw_ids = data.get('deck_ids')
    if raw_ids is None:
        raw_ids = data.get('deckIds')
    return normalize_shared_deck_ids(raw_ids)


# ====================================================================
# 6. Scope-management context resolvers
#   Translate a kid + raw category key into the operating parameters
#   (first_tag, orphan_deck_name, ...) that all per-scope handlers
#   below consume.
# ====================================================================

def resolve_type2_scope_context(kid, raw_category_key):
    """Resolve per-request type-II scope settings for shared deck operations."""
    category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
        kid,
        raw_category_key,
    )
    return {
        'category_key': category_key,
        'has_chinese_specific_logic': bool(has_chinese_specific_logic),
        'first_tag': category_key,
        'orphan_deck_name': get_category_orphan_deck_name(category_key),
        'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
    }


SHARED_SCOPE_MANAGEMENT_TYPE_I = 'type_i'
SHARED_SCOPE_MANAGEMENT_TYPE_II = 'type_ii'
SHARED_SCOPE_MANAGEMENT_TYPE_IV = 'type_iv'


def resolve_shared_scope_management_context(kid, category, raw_category_key):
    """Resolve one shared-scope request into normalized management context."""
    if str(category.get('kind') or '') == 'type4':
        category_key, has_chinese_specific_logic = resolve_kid_type_iv_category_with_mode(
            kid,
            raw_category_key,
        )
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_IV,
            'category_key': category_key,
            'has_chinese_specific_logic': bool(has_chinese_specific_logic),
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'orphan_deck_name': get_category_orphan_deck_name(category_key),
        }
    if str(category.get('kind') or '') == 'type1':
        category_key, has_chinese_specific_logic = resolve_kid_type_i_category_with_mode(
            kid,
            raw_category_key,
        )
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_I,
            'category_key': category_key,
            'has_chinese_specific_logic': bool(has_chinese_specific_logic),
            'chinese_back_content': get_category_chinese_back_content(category_key),
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'orphan_deck_name': get_category_orphan_deck_name(category_key),
        }
    if bool(category.get('use_type_i_card_management')):
        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            raw_category_key,
        )
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_I,
            'category_key': category_key,
            'has_chinese_specific_logic': False,
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'orphan_deck_name': get_category_orphan_deck_name(category_key),
        }
    if bool(category.get('use_type_ii_card_management')):
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_II,
            **resolve_type2_scope_context(kid, raw_category_key),
        }
    raise ValueError('Unsupported shared-deck operation for scope')


# ====================================================================
# 7. Per-scope route handlers
#   Each `*_for_scope(kid_id, category, ...)` is a JSON-returning
#   handler invoked by the dispatcher. They acquire the mutation lock
#   when mutating, do auth via get_kid_for_family, and delegate the
#   heavy lifting to services. SHARED_DECK_OPERATION_HANDLERS (built
#   below) maps each SHARED_DECK_OP_* constant to one of these.
# ====================================================================

def get_shared_decks_for_scope(kid_id, category):
    """Handle shared-decks listing by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            payload = build_type_i_shared_decks_payload(
                kid,
                scope_context['category_key'],
                session_card_count_override=get_category_session_card_count_for_kid(
                    kid,
                    scope_context['category_key'],
                ),
                include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
                include_category_key=True,
            )
            return jsonify(payload), 200
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            payload = build_type_iv_shared_decks_payload(
                kid,
                scope_context['category_key'],
                include_category_key=True,
                include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
            )
            return jsonify(payload), 200
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            first_tag = scope_context['first_tag']
            payload = build_shared_decks_listing_payload(
                kid,
                first_tag=first_tag,
                orphan_deck_name=scope_context['orphan_deck_name'],
                get_shared_decks_fn=lambda conn: get_shared_deck_rows_by_first_tag(
                    conn,
                    first_tag,
                ),
                get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_decks_by_first_tag(
                    conn,
                    first_tag,
                ),
                session_card_count=get_category_session_card_count_for_kid(
                    kid,
                    scope_context['category_key'],
                ),
                include_orphan_in_queue=scope_context['include_orphan_in_queue'],
            )
            payload['category_key'] = scope_context['category_key']
            payload['has_chinese_specific_logic'] = scope_context['has_chinese_specific_logic']
            return jsonify(payload), 200

        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_decks_card_search_index_for_scope(kid_id, category):
    """Return lightweight card index ({deck_id, front, back}) for all shared decks in one scope."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        first_tag = scope_context.get('first_tag') or scope_context.get('category_key')
        management_type = scope_context['management_type']
        shared_conn = get_shared_decks_connection(read_only=True)
        try:
            decks = get_shared_deck_rows_by_first_tag(shared_conn, first_tag)
            deck_ids = [int(deck['deck_id']) for deck in decks]
            cards = []
            if deck_ids:
                placeholders = ','.join(['?'] * len(deck_ids))
                rows = shared_conn.execute(
                    f"""
                    SELECT deck_id, front, back
                    FROM cards
                    WHERE deck_id IN ({placeholders})
                    ORDER BY deck_id ASC, id ASC
                    """,
                    deck_ids
                ).fetchall()
                for row in rows:
                    cards.append({
                        'shared_deck_id': int(row[0]),
                        'is_orphan': False,
                        'front': str(row[1] or ''),
                        'back': str(row[2] or ''),
                    })
        finally:
            shared_conn.close()
        kid_conn = get_kid_connection_for(kid, read_only=True)
        try:
            orphan_deck_id = get_orphan_deck(
                kid_conn,
                get_category_orphan_deck_name(first_tag),
            )
            if orphan_deck_id > 0:
                orphan_rows = kid_conn.execute(
                    "SELECT front, back FROM cards WHERE deck_id = ? ORDER BY id ASC",
                    [orphan_deck_id],
                ).fetchall()
                for row in orphan_rows:
                    cards.append({
                        'shared_deck_id': None,
                        'is_orphan': True,
                        'front': str(row[0] or ''),
                        'back': str(row[1] or ''),
                    })
        finally:
            kid_conn.close()
        return jsonify({
            'cards': cards,
            'management_type': management_type,
            'category_key': scope_context.get('category_key'),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def opt_in_shared_decks_for_scope(kid_id, category):
    """Handle shared-decks opt-in by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        req_payload = request.get_json() or {}
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            req_payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        deck_ids = parse_shared_deck_ids_from_request_payload(req_payload)
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            payload, status_code = opt_in_type_i_shared_decks(
                kid,
                scope_context['category_key'],
                deck_ids,
                scope_context['has_chinese_specific_logic'],
            )
            return jsonify(payload), status_code
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            payload, status_code = opt_in_type_iv_shared_decks(
                kid,
                scope_context['category_key'],
                deck_ids,
            )
            return jsonify(payload), status_code
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            first_tag = scope_context['first_tag']
            payload, status_code = opt_in_shared_decks_internal(
                kid,
                deck_ids,
                first_tag=first_tag,
                orphan_deck_name=scope_context['orphan_deck_name'],
                get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_decks_by_first_tag(
                    conn,
                    first_tag,
                ),
            )
            return jsonify(payload), status_code

        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def opt_out_shared_decks_for_scope(kid_id, category):
    """Handle shared-decks opt-out by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        req_payload = request.get_json() or {}
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            req_payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        deck_ids = parse_shared_deck_ids_from_request_payload(req_payload)
        management_type = scope_context['management_type']
        if management_type not in (
            SHARED_SCOPE_MANAGEMENT_TYPE_I,
            SHARED_SCOPE_MANAGEMENT_TYPE_II,
            SHARED_SCOPE_MANAGEMENT_TYPE_IV,
        ):
            return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
        category_key = scope_context['category_key']
        payload, status_code = opt_out_shared_decks_internal(
            kid,
            deck_ids,
            first_tag=category_key,
            orphan_deck_name=scope_context['orphan_deck_name'],
            get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_decks_by_first_tag(
                conn,
                category_key,
            ),
            delete_type3_audio=management_type == SHARED_SCOPE_MANAGEMENT_TYPE_I,
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_cards_for_scope(kid_id, category):
    """Handle shared-decks cards listing by scope config."""
    cards_handler = category.get('cards_handler')
    if not callable(cards_handler):
        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    return cards_handler(kid_id)


def update_shared_card_skip_for_scope(kid_id, category, card_id):
    """Handle shared card skip updates by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        card_id_int, skipped = parse_shared_card_skip_update_request(card_id)
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        category_key = scope_context['category_key']
        orphan_deck_name = scope_context['orphan_deck_name']
        deck_label = category_key

        payload, status_code = update_shared_card_skip_internal(
            kid,
            card_id_int,
            skipped,
            category_key=category_key,
            orphan_deck_name=orphan_deck_name,
            deck_label=deck_label,
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_decks_for_scope(kid_id, category):
    """Handle merged deck readiness summaries by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        sources = []
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        special_ready_payload = {
            'is_continue_session': False,
            'continue_source_session_id': None,
            'continue_card_count': 0,
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
        }
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            conn = get_kid_connection_for(kid, read_only=True)
            try:
                sources = get_shared_merged_source_decks_for_kid(
                    conn,
                    kid,
                    scope_context['category_key'],
                    include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
                )
                included_sources = [
                    src for src in sources
                    if bool(src.get('included_in_queue')) and int(src.get('active_card_count') or 0) > 0
                ]
                source_deck_ids = [int(src['local_deck_id']) for src in included_sources]
                special_ready_payload = build_special_session_ready_payload(
                    conn,
                    kid,
                    scope_context['category_key'],
                    source_by_deck_id={int(src['local_deck_id']): src for src in included_sources},
                    source_deck_ids=source_deck_ids,
                )
                if not bool(scope_context.get('has_chinese_specific_logic')):
                    special_ready_payload['drill_speed_target_ms'] = (
                        get_category_drill_speed_cutoff_ms_for_kid(
                            conn,
                            scope_context['category_key'],
                        )
                    )
            finally:
                conn.close()
        elif scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            conn = get_kid_connection_for(kid, read_only=True)
            try:
                sources = get_shared_merged_source_decks_for_kid(
                    conn,
                    kid,
                    scope_context['category_key'],
                )
                included_sources = [
                    src for src in sources
                    if bool(src.get('included_in_queue')) and int(src.get('active_card_count') or 0) > 0
                ]
                source_deck_ids = [int(src['local_deck_id']) for src in included_sources]
                pending_card_ids = (
                    get_pending_writing_card_ids(conn)
                    if bool(scope_context.get('has_chinese_specific_logic'))
                    else []
                )
                special_ready_payload = build_special_session_ready_payload(
                    conn,
                    kid,
                    scope_context['category_key'],
                    source_by_deck_id={int(src['local_deck_id']): src for src in included_sources},
                    source_deck_ids=source_deck_ids,
                    excluded_card_ids=pending_card_ids,
                )
            finally:
                conn.close()
        elif scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            conn = get_kid_connection_for(kid, read_only=True)
            try:
                practice_sources = get_type_iv_practice_source_rows(
                    conn,
                    kid,
                    scope_context['category_key'],
                    include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
                )
                special_ready_payload = build_type_iv_special_session_ready_payload(
                    conn,
                    kid,
                    scope_context['category_key'],
                    practice_sources,
                )
            finally:
                conn.close()

            listing_payload = build_type_iv_shared_decks_payload(
                kid,
                scope_context['category_key'],
                include_category_key=True,
                include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
            )
            readiness_decks = []
            for deck in list(listing_payload.get('decks') or []):
                readiness_decks.append({
                    'key': f"shared_{int(deck.get('deck_id') or 0)}",
                    'label': str(deck.get('representative_front') or deck.get('name') or ''),
                    'deck_id': int(deck.get('materialized_deck_id') or 0),
                    'shared_deck_id': int(deck.get('deck_id') or 0),
                    'total_cards': int(deck.get('card_count') or 0),
                    'session_count': int(deck.get('daily_target_count') or 0) if bool(deck.get('opted_in')) else 0,
                    'included_in_queue': bool(deck.get('opted_in')) and int(deck.get('daily_target_count') or 0) > 0,
                    'is_orphan': False,
                    'opted_in': bool(deck.get('opted_in')),
                    'daily_target_count': int(deck.get('daily_target_count') or 0),
                })
            orphan_payload = listing_payload.get('orphan_deck') if isinstance(listing_payload, dict) else None
            if isinstance(orphan_payload, dict) and int(orphan_payload.get('card_count') or 0) > 0:
                orphan_active_card_count = int(orphan_payload.get('active_card_count') or 0)
                orphan_daily_target_count = int(orphan_payload.get('daily_target_count') or 0)
                orphan_included = bool(scope_context['include_orphan_in_queue'])
                readiness_decks.append({
                    'key': 'orphan',
                    'label': str(orphan_payload.get('name') or scope_context['orphan_deck_name'] or 'Personal Deck'),
                    'deck_id': int(orphan_payload.get('deck_id') or 0),
                    'shared_deck_id': None,
                    'total_cards': orphan_active_card_count,
                    'session_count': (
                        orphan_daily_target_count
                        if orphan_included and orphan_active_card_count > 0
                        else 0
                    ),
                    'included_in_queue': bool(
                        orphan_included and orphan_active_card_count > 0 and orphan_daily_target_count > 0
                    ),
                    'is_orphan': True,
                    'opted_in': bool(orphan_included),
                    'daily_target_count': orphan_daily_target_count,
                })
            total_session_count = int(listing_payload.get('session_card_count') or 0)
            return jsonify({
                'category_key': scope_context['category_key'],
                'decks': readiness_decks,
                'total_session_count': total_session_count,
                'configured_session_count': total_session_count,
                'total_active_cards': sum(int(deck.get('total_cards') or 0) for deck in readiness_decks if bool(deck.get('included_in_queue'))),
                'include_orphan_in_queue': bool(scope_context['include_orphan_in_queue']),
                'has_chinese_specific_logic': False,
                **special_ready_payload,
            }), 200
        else:
            return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404

        payload = build_merged_source_decks_payload(
            sources,
            get_category_session_card_count_for_kid(kid, scope_context['category_key']),
            scope_context['include_orphan_in_queue'],
        )
        return jsonify({
            'category_key': scope_context['category_key'],
            **payload,
            'has_chinese_specific_logic': bool(scope_context['has_chinese_specific_logic']),
            'chinese_back_content': scope_context.get('chinese_back_content') or '',
            **special_ready_payload,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def update_shared_card_skip_bulk_for_scope(kid_id, category):
    """Handle bulk shared card skip updates by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        card_ids, skipped = parse_shared_card_skip_bulk_update_request()
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        category_key = scope_context['category_key']
        orphan_deck_name = scope_context['orphan_deck_name']
        deck_label = category_key

        payload, status_code = update_shared_cards_skip_bulk_internal(
            kid,
            card_ids,
            skipped,
            category_key=category_key,
            orphan_deck_name=orphan_deck_name,
            deck_label=deck_label,
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ====================================================================
# 8. Operation dispatch table
#   Maps SHARED_DECK_OP_* constants to per-scope handlers above.
#   run_shared_deck_scope_operation looks up the handler and invokes
#   it; SKIP_UPDATE is the only op that passes a card_id arg.
# ====================================================================

SHARED_DECK_OPERATION_HANDLERS = {
    SHARED_DECK_OP_GET: get_shared_decks_for_scope,
    SHARED_DECK_OP_OPT_IN: opt_in_shared_decks_for_scope,
    SHARED_DECK_OP_OPT_OUT: opt_out_shared_decks_for_scope,
    SHARED_DECK_OP_GET_CARDS: get_shared_cards_for_scope,
    SHARED_DECK_OP_SKIP_UPDATE: update_shared_card_skip_for_scope,
    SHARED_DECK_OP_SKIP_UPDATE_BULK: update_shared_card_skip_bulk_for_scope,
    SHARED_DECK_OP_GET_DECKS: get_decks_for_scope,
    SHARED_DECK_OP_CARD_SEARCH_INDEX: get_shared_decks_card_search_index_for_scope,
}


def run_shared_deck_scope_operation(operation, kid_id, category, *, card_id=None):
    """Run one shared deck operation via generic operation handlers."""
    handler = SHARED_DECK_OPERATION_HANDLERS.get(operation)
    if handler is None:
        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    if operation == SHARED_DECK_OP_SKIP_UPDATE:
        return handler(kid_id, category, card_id)
    return handler(kid_id, category)


def get_shared_type3_cards(kid_id):
    """Get merged cards across opted-in type-III decks and orphan deck."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        payload = build_type_i_shared_cards_payload(
            kid,
            category_key,
            include_practiced_from_other=parse_include_practiced_from_other_arg(),
        )
        payload.update(build_kid_daily_progress_section(kid, category_key))
        return jsonify(payload), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_type4_cards(kid_id):
    """Get representative cards across opted-in type-IV decks."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        payload = build_type_iv_shared_cards_payload(
            kid,
            category_key,
        )
        payload.update(build_kid_daily_progress_section(kid, category_key))
        return jsonify(payload), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_type2_cards(kid_id):
    """Get merged cards across opted-in type-II decks and orphan deck."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        category_display_name = get_deck_category_display_name(
            category_key,
            get_shared_deck_category_meta_by_key(),
        )

        conn = get_kid_connection_for(kid, read_only=True)
        try:
            sources = get_shared_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            bank_sources = [
                src for src in sources
                if int(src.get('card_count') or 0) > 0 and bool(src.get('included_in_bank', True))
            ]
            bank_deck_ids = [int(src['local_deck_id']) for src in bank_sources]
            practice_sources = [src for src in sources if bool(src.get('included_in_queue'))]
            practice_source_ids = [
                int(src['local_deck_id'])
                for src in practice_sources
                if int(src.get('active_card_count') or 0) > 0
            ]

            pending_card_ids = []
            pending_card_set = set()
            candidate_rows = []
            candidate_card_ids = []
            candidate_card_set = set()
            candidate_reason_by_card = {}
            preview_excluded_ids = []
            if has_chinese_specific_logic:
                pending_card_ids = get_pending_writing_card_ids(conn)
                pending_card_set = set(pending_card_ids)
                preview_excluded_ids = list(pending_card_set)
                candidate_rows = get_writing_candidate_rows(
                    conn,
                    bank_deck_ids,
                    category_key,
                    excluded_card_ids=pending_card_ids,
                )
                candidate_card_ids = [int(row[0]) for row in candidate_rows]
                candidate_card_set = set(candidate_card_ids)
                for row in candidate_rows:
                    card_id = int(row[0])
                    latest_correct = int(row[3]) if row[3] is not None else None
                    if latest_correct is None:
                        candidate_reason_by_card[card_id] = ('never_seen', 'Newly added')
                    else:
                        candidate_reason_by_card[card_id] = ('last_failed', 'Last failed')
            special_ready_payload = build_special_session_ready_payload(
                conn,
                kid,
                category_key,
                source_by_deck_id={
                    int(src['local_deck_id']): src
                    for src in practice_sources
                    if int(src.get('active_card_count') or 0) > 0
                },
                source_deck_ids=practice_source_ids,
                excluded_card_ids=pending_card_ids,
            )

            preview_order = {}
            practice_priority_preview_by_card_id = {}
            practice_priority_subject_baseline = {
                'p50_correct_time': None,
                'p90_correct_time': None,
                'correct_sample_count': 0,
            }
            if practice_source_ids:
                priority_preview = build_practice_priority_preview_for_decks(
                    conn,
                    practice_source_ids,
                    category_key,
                    get_session_behavior_type(category_key),
                    excluded_card_ids=preview_excluded_ids,
                )
                preview_order = priority_preview['order_by_card_id']
                practice_priority_preview_by_card_id = priority_preview['details_by_card_id']
                practice_priority_subject_baseline = priority_preview['subject_baseline']

            orphan_deck_name = get_category_orphan_deck_name(category_key)

            def _source_label(source):
                tags = extract_shared_deck_tags_and_labels(source.get('tags') or [])[0]
                tail = tags[1:] if len(tags) > 1 else []
                if tail:
                    return ' / '.join(tail)
                local_name = str(source.get('local_name') or '')
                if local_name == orphan_deck_name:
                    return 'orphan'
                return local_name

            bank_deck_ids = [int(src['local_deck_id']) for src in bank_sources if int(src.get('local_deck_id') or 0) > 0]
            card_rows_by_deck_id = {}
            for row in get_cards_with_stats_for_deck_ids(conn, bank_deck_ids):
                deck_id = int(row[1] or 0)
                if deck_id > 0:
                    card_rows_by_deck_id.setdefault(deck_id, []).append(row)

            merged_cards = []
            for src in bank_sources:
                local_deck_id = int(src['local_deck_id'])
                rows = card_rows_by_deck_id.get(local_deck_id) or []
                source_tags = extract_shared_deck_tags_and_labels(src.get('tags') or [])[0]
                label = _source_label(src)
                source_name = str(src.get('local_name') or '')
                is_orphan = bool(src.get('is_orphan'))
                for row in rows:
                    mapped = map_card_row(row, preview_order, practice_priority_preview_by_card_id)
                    card_id = int(row[0])
                    is_candidate = card_id in candidate_card_set
                    mapped['pending_sheet'] = card_id in pending_card_set
                    mapped['available_for_practice'] = (not mapped['pending_sheet'])
                    mapped['practicing_reason'] = None
                    mapped['practicing_reason_label'] = None
                    if mapped['pending_sheet']:
                        mapped['writing_state'] = 3
                        mapped['writing_state_label'] = 'In Practicing Sheet'
                    elif is_candidate:
                        mapped['writing_state'] = 2
                        mapped['writing_state_label'] = 'Ready for Practicing Sheet'
                        reason = candidate_reason_by_card.get(card_id)
                        if reason:
                            mapped['practicing_reason'] = reason[0]
                            mapped['practicing_reason_label'] = reason[1]
                    else:
                        mapped['writing_state'] = 1
                        mapped['writing_state_label'] = 'Default'
                    mapped['source_deck_id'] = local_deck_id
                    mapped['source_deck_name'] = source_name
                    mapped['source_deck_label'] = label
                    mapped['source_deck_tags'] = source_tags
                    mapped['source_is_orphan'] = is_orphan
                    audio_meta = build_writing_prompt_audio_payload(
                        kid_id,
                        mapped.get('front'),
                        mapped.get('back'),
                        category_key=category_key,
                    )
                    mapped['audio_file_name'] = audio_meta['audio_file_name']
                    mapped['audio_mime_type'] = audio_meta['audio_mime_type']
                    mapped['audio_url'] = audio_meta['audio_url']
                    mapped['prompt_audio_url'] = audio_meta['prompt_audio_url']
                    merged_cards.append(mapped)

            if parse_include_practiced_from_other_arg():
                existing_ids = {
                    int(card.get('id'))
                    for card in merged_cards
                    if int(card.get('id') or 0) > 0
                }
                practiced_ids = get_card_ids_practiced_for_category(conn, category_key)
                extra_ids = [cid for cid in practiced_ids if cid not in existing_ids]
                for row in get_cards_with_stats_for_card_ids(conn, extra_ids):
                    mapped = map_card_row(row, preview_order, practice_priority_preview_by_card_id)
                    mapped['pending_sheet'] = False
                    mapped['available_for_practice'] = False
                    mapped['practicing_reason'] = None
                    mapped['practicing_reason_label'] = None
                    mapped['writing_state'] = 1
                    mapped['writing_state_label'] = 'Default'
                    mapped['source_deck_id'] = int(row[1] or 0)
                    mapped['source_deck_name'] = ''
                    mapped['source_deck_label'] = ''
                    mapped['source_deck_tags'] = []
                    mapped['source_is_orphan'] = False
                    mapped['from_practice_history'] = True
                    mapped['audio_file_name'] = None
                    mapped['audio_mime_type'] = None
                    mapped['audio_url'] = None
                    mapped['prompt_audio_url'] = None
                    merged_cards.append(mapped)

            merged_by_id = {
                int(card.get('id')): card
                for card in merged_cards
                if int(card.get('id') or 0) > 0
            }
            practicing_cards = []
            for card_id in candidate_card_ids:
                card = merged_by_id.get(int(card_id))
                if card is not None and int(card.get('writing_state') or 0) == 2:
                    practicing_cards.append(card)
            practicing_sheet_cards = [
                card for card in merged_cards
                if int(card.get('writing_state') or 0) == 3
            ]

            active_count = sum(int(src.get('active_card_count') or 0) for src in bank_sources)
            skipped_count = sum(int(src.get('skipped_card_count') or 0) for src in bank_sources)
            practice_active_count = sum(int(src.get('active_card_count') or 0) for src in practice_sources)
            orphan_deck_id = get_category_orphan_deck(conn, category_key)
        finally:
            conn.close()

        return jsonify({
            'category_key': category_key,
            'has_chinese_specific_logic': bool(has_chinese_specific_logic),
            'is_merged_bank': True,
            'deck_name': f'Merged {category_display_name} Bank',
            'deck_id': orphan_deck_id,
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'practice_source_count': len(practice_sources),
            'practice_active_card_count': int(practice_active_count),
            'active_card_count': active_count,
            'skipped_card_count': skipped_count,
            'practicing_card_count': len(practicing_cards),
            'practicing_cards': practicing_cards,
            'practicing_sheet_card_count': len(practicing_sheet_cards),
            'practicing_sheet_cards': practicing_sheet_cards,
            'practice_priority_subject_baseline': practice_priority_subject_baseline,
            'cards': merged_cards,
            **special_ready_payload,
            **build_kid_daily_progress_section(kid, category_key),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ====================================================================
# 9. CATEGORY_CONFIG wiring
#   Final scope → config map (populated after all handlers are defined).
#   Each scope maps to a behavior kind + cards_handler used by the
#   dispatcher above.
# ====================================================================

CATEGORY_CONFIG.update({
    SHARED_DECK_SCOPE_TYPE1: {
        'kind': 'type1',
        'cards_handler': get_shared_type1_cards,
    },
    SHARED_DECK_SCOPE_TYPE3: {
        'kind': 'type3',
        'use_type_i_card_management': True,
        'cards_handler': get_shared_type3_cards,
    },
    SHARED_DECK_SCOPE_TYPE2: {
        'kind': 'type2',
        'use_type_ii_card_management': True,
        'cards_handler': get_shared_type2_cards,
    },
    SHARED_DECK_SCOPE_TYPE4: {
        'kind': 'type4',
        'cards_handler': get_shared_type4_cards,
    },
})



# ====================================================================
# 10. Re-exports + sibling-route-module loads
#   __all__ exposes underscore-prefixed module state so sibling modules
#   can `from src.routes.kids import _PENDING_SESSIONS, ...`. Sibling
#   imports MUST be the last lines so all helpers + __all__ are ready.
# ====================================================================

__all__ = [
    _name for _name in dict(globals()).keys()
    if not _name.startswith('__') and _name != '_name'
]

from . import shared_decks  # noqa: E402,F401
from . import kids_core  # noqa: E402,F401
from . import kid_decks  # noqa: E402,F401
from . import type2  # noqa: E402,F401
from . import type4  # noqa: E402,F401
from . import lesson_reading  # noqa: E402,F401
from . import practice  # noqa: E402,F401
from . import chinese_bank  # noqa: E402,F401
