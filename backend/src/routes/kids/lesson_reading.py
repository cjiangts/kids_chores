"""Lesson-reading (Type III) audio routes."""
from src.routes.kids import *  # noqa: F401,F403  -- pulls in kids_bp + helpers/state

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
        passthrough_ext = os.path.splitext(file_name)[1] or '.webm'
        passthrough_name = f'{base_stem}{passthrough_ext}'
        passthrough_mime = mimetypes.guess_type(file_name)[0] or 'application/octet-stream'
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

        ffmpeg_exe = resolve_ffmpeg_executable()
        if not ffmpeg_exe:
            return send_file(
                audio_path,
                mimetype=passthrough_mime,
                as_attachment=True,
                download_name=passthrough_name,
            )

        ffmpeg_cmd = [
            ffmpeg_exe,
            '-v', 'error',
            '-i', audio_path,
            '-vn',
            '-c:a', 'libmp3lame',
            '-b:a', '160k',
            '-f', 'mp3',
            'pipe:1',
        ]
        process = subprocess.run(
            ffmpeg_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if process.returncode != 0 or not process.stdout:
            return send_file(
                audio_path,
                mimetype=passthrough_mime,
                as_attachment=True,
                download_name=passthrough_name,
            )

        return send_file(
            BytesIO(process.stdout),
            mimetype='audio/mpeg',
            as_attachment=True,
            download_name=output_name,
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


