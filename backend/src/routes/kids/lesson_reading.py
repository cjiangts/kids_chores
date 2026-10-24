"""Lesson-reading (Type III) audio routes.

Layout:
  1. Per-file MP3 transcode locks + on-demand MP3-sibling materializer
  2. Single-recording fetch + MP3 download (transcoded on demand)
  3. Fastest-correct recordings zip bundle
"""
import zipfile
from src.routes.kids import (
    BytesIO,
    get_kid_type3_audio_dir,
    jsonify,
    kids_bp,
    mimetypes,
    os,
    request,
    send_file,
    send_from_directory,
)
from src.services.audio_io import (
    sanitize_download_filename_stem,
)
from src.services.recording_audio import ensure_recording_mp3, recording_audio_lock
from src.services.family_auth import get_kid_connection_for, get_kid_for_family
from src.services.normalize_inputs import normalize_positive_int_list
from src.services.shared_deck_category import is_type_iii_session_type


# =====================================================================
# === 1. Per-file MP3 transcode locks + on-demand MP3-sibling materializer
# =====================================================================

def _ensure_type3_mp3_sibling(audio_dir, file_name, stored_mime_type):
    """Materialize MP3 for playback; maintenance later retires the original."""
    if os.path.splitext(file_name)[1].lower() == '.mp3' or stored_mime_type == 'audio/mpeg':
        return None, None
    try:
        with recording_audio_lock(audio_dir):
            return ensure_recording_mp3(audio_dir, file_name), 'audio/mpeg'
    except Exception:
        return None, None


# =====================================================================
# === 2. Single-recording fetch + MP3 download (transcoded on demand)
# =====================================================================

def _resolve_type3_audio_request(kid_id, file_name):
    """Return ({kid, audio_dir, audio_path, stored_mime_type, raw_mime_type}, None) or (None, error_response)."""
    kid = get_kid_for_family(kid_id)
    if not kid:
        return None, (jsonify({'error': 'Kid not found'}), 404)
    if file_name != os.path.basename(file_name):
        return None, (jsonify({'error': 'Invalid file name'}), 400)
    audio_dir = get_kid_type3_audio_dir(kid)
    audio_path = os.path.join(audio_dir, file_name)
    if not os.path.exists(audio_path):
        return None, (jsonify({'error': 'Audio file not found'}), 404)
    conn = get_kid_connection_for(kid, read_only=True)
    row = conn.execute(
        """
        SELECT lra.mime_type, s.type
        FROM lesson_reading_audio lra
        JOIN session_results sr ON sr.id = lra.result_id
        JOIN sessions s ON s.id = sr.session_id
        WHERE lra.file_name = ?
        LIMIT 1
        """,
        [file_name],
    ).fetchone()
    conn.close()
    if not row or not is_type_iii_session_type(row[1]):
        return None, (jsonify({'error': 'Audio file not found'}), 404)
    raw_mime_type = row[0] if row[0] else None
    return {
        'kid': kid,
        'audio_dir': audio_dir,
        'audio_path': audio_path,
        'stored_mime_type': str(raw_mime_type or '').strip().lower(),
        'raw_mime_type': raw_mime_type,
    }, None


@kids_bp.route('/kids/<kid_id>/lesson-reading/audio/<path:file_name>', methods=['GET'])
def get_type3_audio(kid_id, file_name):
    """Serve type-III recording audio file for one kid."""
    try:
        ctx, err = _resolve_type3_audio_request(kid_id, file_name)
        if err:
            return err
        audio_dir = ctx['audio_dir']
        stored_mime_type = ctx['stored_mime_type']

        sibling_name, sibling_mime = _ensure_type3_mp3_sibling(audio_dir, file_name, stored_mime_type)
        if sibling_name:
            return send_from_directory(audio_dir, sibling_name, as_attachment=False, mimetype=sibling_mime)

        return send_from_directory(audio_dir, file_name, as_attachment=False, mimetype=ctx['raw_mime_type'])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/audio/<path:file_name>/download-mp3', methods=['GET'])
def download_type3_audio_as_mp3(kid_id, file_name):
    """Download one type-III recording as MP3 (transcoded on demand)."""
    try:
        ctx, err = _resolve_type3_audio_request(kid_id, file_name)
        if err:
            return err
        audio_dir = ctx['audio_dir']
        audio_path = ctx['audio_path']
        stored_mime_type = ctx['stored_mime_type']

        requested_name = request.args.get('downloadName')
        base_stem = sanitize_download_filename_stem(
            requested_name or os.path.splitext(file_name)[0],
            fallback='recording'
        )
        kid_name_stem = sanitize_download_filename_stem(
            str(ctx['kid'].get('name') or '').strip() or 'kid',
            fallback='kid',
        )
        output_name = f'{kid_name_stem}-{base_stem}.mp3'
        source_ext = os.path.splitext(file_name)[1].lower()
        source_is_mp3 = (
            source_ext == '.mp3'
            or stored_mime_type == 'audio/mpeg'
        )

        if source_is_mp3:
            return send_file(
                audio_path,
                mimetype='audio/mpeg',
                as_attachment=True,
                download_name=output_name,
            )

        sibling_name, _sibling_mime = _ensure_type3_mp3_sibling(audio_dir, file_name, stored_mime_type)
        if sibling_name:
            return send_from_directory(
                audio_dir,
                sibling_name,
                as_attachment=True,
                mimetype='audio/mpeg',
                download_name=output_name,
            )

        passthrough_ext = os.path.splitext(file_name)[1] or '.webm'
        passthrough_name = f'{base_stem}{passthrough_ext}'
        passthrough_mime = mimetypes.guess_type(file_name)[0] or 'application/octet-stream'
        return send_file(
            audio_path,
            mimetype=passthrough_mime,
            as_attachment=True,
            download_name=passthrough_name,
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =====================================================================
# === 3. Fastest-correct recordings zip bundle
# =====================================================================

@kids_bp.route('/kids/<kid_id>/lesson-reading/recordings/download-zip', methods=['POST'])
def download_type3_fastest_correct_recordings_zip(kid_id):
    """Bundle each card's fastest correct type-III recording into a single zip."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json(silent=True) or {}
        card_ids = sorted(normalize_positive_int_list(payload.get('card_ids') or []))
        if not card_ids:
            return jsonify({'error': 'No card ids provided'}), 400

        audio_dir = get_kid_type3_audio_dir(kid)
        if not os.path.isdir(audio_dir):
            return jsonify({'error': 'No recordings found for this kid.'}), 404

        placeholders = ','.join(['?'] * len(card_ids))
        conn = get_kid_connection_for(kid, read_only=True)
        rows = conn.execute(
            f"""
            SELECT
                sr.card_id,
                sr.correct,
                COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                lra.file_name,
                lra.mime_type,
                s.type AS session_type,
                c.front
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            JOIN lesson_reading_audio lra ON lra.result_id = sr.id
            LEFT JOIN cards c ON c.id = sr.card_id
            WHERE sr.card_id IN ({placeholders})
              AND (sr.correct = 1 OR sr.correct <= -2)
              AND COALESCE(sr.response_time_ms, 0) > 0
            ORDER BY sr.card_id ASC, response_time_ms ASC, sr.id ASC
            """,
            card_ids,
        ).fetchall()
        conn.close()

        best_by_card = {}
        for row in rows:
            if not is_type_iii_session_type(row[5]):
                continue
            card_id_int = int(row[0])
            if card_id_int in best_by_card:
                continue
            file_name = str(row[3] or '').strip()
            if not file_name or file_name != os.path.basename(file_name):
                continue
            audio_path = os.path.join(audio_dir, file_name)
            if not os.path.exists(audio_path):
                continue
            best_by_card[card_id_int] = {
                'file_name': file_name,
                'mime_type': str(row[4] or '').strip().lower() if row[4] else '',
                'response_time_ms': int(row[2] or 0),
                'card_front': str(row[6] or '').strip(),
            }

        if not best_by_card:
            return jsonify({'error': 'No correct recordings found for the selected cards.'}), 404

        kid_name_stem = sanitize_download_filename_stem(
            str(kid.get('name') or '').strip() or 'kid',
            fallback='kid',
        )
        used_names = set()
        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_STORED) as zip_file:
            for card_id_int in card_ids:
                entry = best_by_card.get(card_id_int)
                if not entry:
                    continue
                file_name = entry['file_name']
                source_ext = os.path.splitext(file_name)[1].lower()
                source_is_mp3 = source_ext == '.mp3' or entry['mime_type'] == 'audio/mpeg'

                source_path = os.path.join(audio_dir, file_name)
                arc_ext = '.mp3'
                arc_path = source_path
                if not source_is_mp3:
                    sibling_name, _sibling_mime = _ensure_type3_mp3_sibling(
                        audio_dir, file_name, entry['mime_type']
                    )
                    if sibling_name:
                        arc_path = os.path.join(audio_dir, sibling_name)
                    else:
                        arc_ext = source_ext or '.webm'
                        arc_path = source_path

                stem = sanitize_download_filename_stem(
                    entry['card_front'] or f'card-{card_id_int}',
                    fallback=f'card-{card_id_int}',
                )
                candidate = f'{kid_name_stem}-{stem}{arc_ext}'
                suffix = 2
                while candidate in used_names:
                    candidate = f'{kid_name_stem}-{stem} ({suffix}){arc_ext}'
                    suffix += 1
                used_names.add(candidate)
                zip_file.write(arc_path, arcname=candidate)

        zip_buffer.seek(0)
        zip_filename = f'{kid_name_stem}-recordings.zip'
        return send_file(
            zip_buffer,
            mimetype='application/zip',
            as_attachment=True,
            download_name=zip_filename,
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

