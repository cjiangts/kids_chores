"""Lesson-reading (Type III) audio routes."""
import zipfile
from src.routes.kids import *  # noqa: F401,F403  -- pulls in kids_bp + helpers/state


_TYPE3_MP3_TRANSCODE_LOCKS = {}
_TYPE3_MP3_TRANSCODE_LOCKS_GUARD = threading.Lock()


def _get_type3_mp3_transcode_lock(key):
    with _TYPE3_MP3_TRANSCODE_LOCKS_GUARD:
        lock = _TYPE3_MP3_TRANSCODE_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _TYPE3_MP3_TRANSCODE_LOCKS[key] = lock
        return lock


def _ensure_type3_mp3_sibling(audio_dir, file_name, stored_mime_type):
    """Return (sibling_name, sibling_mime) if an MP3 sibling is available; else (None, None)."""
    source_ext = os.path.splitext(file_name)[1].lower()
    if source_ext == '.mp3' or stored_mime_type == 'audio/mpeg':
        return None, None

    sibling_stem = os.path.splitext(file_name)[0]
    sibling_name = f'{sibling_stem}.mp3'
    sibling_path = os.path.join(audio_dir, sibling_name)
    if os.path.exists(sibling_path):
        return sibling_name, 'audio/mpeg'

    ffmpeg_exe = resolve_ffmpeg_executable()
    if not ffmpeg_exe:
        return None, None

    lock = _get_type3_mp3_transcode_lock(sibling_path)
    with lock:
        if os.path.exists(sibling_path):
            return sibling_name, 'audio/mpeg'

        source_path = os.path.join(audio_dir, file_name)
        tmp_path = f'{sibling_path}.{uuid.uuid4().hex}.tmp'
        ffmpeg_cmd = [
            ffmpeg_exe,
            '-v', 'error',
            '-i', source_path,
            '-vn',
            '-c:a', 'libmp3lame',
            '-b:a', '160k',
            '-f', 'mp3',
            tmp_path,
        ]
        try:
            process = subprocess.run(
                ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            if process.returncode != 0 or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
                return None, None
            os.replace(tmp_path, sibling_path)
        except Exception:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            return None, None

    return sibling_name, 'audio/mpeg'


@kids_bp.route('/kids/<kid_id>/lesson-reading/audio/<path:file_name>', methods=['GET'])
def get_type3_audio(kid_id, file_name):
    """Serve type-III recording audio file for one kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        audio_dir = get_kid_type3_audio_dir(kid)
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

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
            [file_name]
        ).fetchone()
        conn.close()

        if not row or not is_type_iii_session_type(row[1]):
            return jsonify({'error': 'Audio file not found'}), 404

        stored_mime_type = str(row[0] or '').strip().lower() if row and row[0] else ''

        sibling_name, sibling_mime = _ensure_type3_mp3_sibling(audio_dir, file_name, stored_mime_type)
        if sibling_name:
            return send_from_directory(audio_dir, sibling_name, as_attachment=False, mimetype=sibling_mime)

        mime_type = row[0] if row and row[0] else None
        return send_from_directory(audio_dir, file_name, as_attachment=False, mimetype=mime_type)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/audio/<path:file_name>/download-mp3', methods=['GET'])
def download_type3_audio_as_mp3(kid_id, file_name):
    """Download one type-III recording as MP3 (transcoded on demand)."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        audio_dir = get_kid_type3_audio_dir(kid)
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

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
            [file_name]
        ).fetchone()
        conn.close()

        if not row or not is_type_iii_session_type(row[1]):
            return jsonify({'error': 'Audio file not found'}), 404
        stored_mime_type = str(row[0] or '').strip().lower()

        requested_name = request.args.get('downloadName')
        base_stem = sanitize_download_filename_stem(
            requested_name or os.path.splitext(file_name)[0],
            fallback='recording'
        )
        output_name = f'{base_stem}.mp3'
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


@kids_bp.route('/kids/<kid_id>/lesson-reading/recordings/download-zip', methods=['POST'])
def download_type3_fastest_correct_recordings_zip(kid_id):
    """Bundle each card's fastest correct type-III recording into a single zip."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json(silent=True) or {}
        raw_card_ids = payload.get('card_ids') or []
        card_ids = []
        for value in raw_card_ids:
            try:
                card_id_int = int(value)
            except (TypeError, ValueError):
                continue
            if card_id_int > 0:
                card_ids.append(card_id_int)
        card_ids = sorted(set(card_ids))
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
                candidate = f'{stem}{arc_ext}'
                suffix = 2
                while candidate in used_names:
                    candidate = f'{stem} ({suffix}){arc_ext}'
                    suffix += 1
                used_names.add(candidate)
                zip_file.write(arc_path, arcname=candidate)

        zip_buffer.seek(0)
        kid_name_stem = sanitize_download_filename_stem(
            str(kid.get('name') or '').strip() or 'kid',
            fallback='kid',
        )
        zip_filename = f'{kid_name_stem}-recordings.zip'
        return send_file(
            zip_buffer,
            mimetype='application/zip',
            as_attachment=True,
            download_name=zip_filename,
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


