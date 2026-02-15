"""Backup and restore routes (family-scoped)."""
from flask import Blueprint, send_file, request, jsonify, session
import os
import zipfile
import tempfile
from datetime import datetime
import shutil
import json
from src.db import metadata, kid_db

backup_bp = Blueprint('backup', __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data')
FAMILIES_ROOT = os.path.join(DATA_DIR, 'families')


def _current_family_id():
    return str(session.get('family_id') or '')


def _family_audio_dir(kid):
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    return os.path.join(FAMILIES_ROOT, f'family_{family_id}', 'writing_audio', f'kid_{kid_id}')


def _rel_to_data(abs_path):
    return os.path.relpath(abs_path, DATA_DIR)

@backup_bp.route('/backup/download', methods=['GET'])
def download_backup():
    """Create a zip backup for current family only."""
    try:
        family_id = _current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401

        family = metadata.get_family_by_id(family_id)
        if not family:
            return jsonify({'error': 'Family not found'}), 404
        kids = metadata.get_all_kids(family_id=family_id)

        # Create temporary zip file
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        temp_dir = tempfile.mkdtemp()
        zip_path = os.path.join(temp_dir, f'kids_learning_family_{family_id}_backup_{timestamp}.zip')

        files_to_include = []
        for kid in kids:
            db_rel = str(kid.get('dbFilePath') or '')
            if db_rel:
                db_abs = kid_db.get_absolute_db_path(db_rel)
                if os.path.exists(db_abs):
                    files_to_include.append(_rel_to_data(db_abs))

            audio_dir = _family_audio_dir(kid)
            if os.path.exists(audio_dir):
                for root, _, files in os.walk(audio_dir):
                    for file_name in files:
                        abs_path = os.path.join(root, file_name)
                        files_to_include.append(_rel_to_data(abs_path))

        manifest = {
            'family': {
                'id': str(family.get('id')),
                'username': family.get('username')
            },
            'kids': kids,
            'files': sorted(set(files_to_include)),
            'exportedAt': datetime.now().isoformat()
        }

        # Create zip file
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            zipf.writestr('family_manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
            for rel_path in manifest['files']:
                abs_path = os.path.join(DATA_DIR, rel_path)
                if os.path.exists(abs_path):
                    zipf.write(abs_path, rel_path)

        # Send file
        return send_file(
            zip_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f'kids_learning_family_{family_id}_backup_{timestamp}.zip'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@backup_bp.route('/backup/restore', methods=['POST'])
def restore_backup():
    """Restore current family data from family-scoped backup zip."""
    try:
        family_id = _current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401

        # Check if file was uploaded
        if 'backup' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400

        file = request.files['backup']

        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        if not file.filename.endswith('.zip'):
            return jsonify({'error': 'File must be a zip file'}), 400

        # Save uploaded file temporarily.
        temp_dir = tempfile.mkdtemp()
        zip_path = os.path.join(temp_dir, 'backup.zip')
        file.save(zip_path)

        # Ensure data directory exists.
        os.makedirs(DATA_DIR, exist_ok=True)

        with zipfile.ZipFile(zip_path, 'r') as zipf:
            if 'family_manifest.json' not in zipf.namelist():
                return jsonify({'error': 'Invalid family backup format'}), 400
            manifest = json.loads(zipf.read('family_manifest.json').decode('utf-8'))
            source_family_id = str(((manifest.get('family') or {}).get('id')) or '')
            if source_family_id != family_id:
                return jsonify({'error': 'Backup belongs to a different family account'}), 400

            kids_from_backup = manifest.get('kids') or []
            files_from_backup = manifest.get('files') or []

            # Remove current family's kid files and metadata entries first.
            existing_kids = metadata.get_all_kids(family_id=family_id)
            for kid in existing_kids:
                try:
                    kid_db.delete_kid_database_by_path(kid.get('dbFilePath') or '')
                except Exception:
                    pass
                audio_dir = _family_audio_dir(kid)
                if os.path.exists(audio_dir):
                    shutil.rmtree(audio_dir, ignore_errors=True)
                metadata.delete_kid(kid.get('id'), family_id=family_id)

            # Restore files listed in manifest.
            for rel_path in files_from_backup:
                if rel_path == 'family_manifest.json':
                    continue
                if rel_path.startswith('/') or '..' in rel_path.split('/'):
                    continue
                if rel_path not in zipf.namelist():
                    continue
                target_abs = os.path.join(DATA_DIR, rel_path)
                os.makedirs(os.path.dirname(target_abs), exist_ok=True)
                with zipf.open(rel_path) as src, open(target_abs, 'wb') as dst:
                    shutil.copyfileobj(src, dst)

            # Restore kids metadata for this family only.
            for kid in kids_from_backup:
                restored = {**kid, 'familyId': family_id}
                metadata.add_kid(restored)

        # Clean up temp files.
        shutil.rmtree(temp_dir)

        return jsonify({
            'success': True,
            'message': 'Family backup restored successfully'
        }), 200

    except Exception as e:
        return jsonify({'error': f'Restore failed: {str(e)}'}), 500

@backup_bp.route('/backup/info', methods=['GET'])
def backup_info():
    """Get backup information for current family only."""
    try:
        family_id = _current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kids = metadata.get_all_kids(family_id=family_id)

        info = {
            'family_id': family_id,
            'data_dir_exists': os.path.exists(DATA_DIR),
            'files': [],
            'kids_count': len(kids)
        }

        files_seen = set()
        for kid in kids:
            db_rel = str(kid.get('dbFilePath') or '')
            if db_rel:
                db_abs = kid_db.get_absolute_db_path(db_rel)
                if os.path.exists(db_abs):
                    files_seen.add(db_abs)
            audio_dir = _family_audio_dir(kid)
            if os.path.exists(audio_dir):
                for root, _, files in os.walk(audio_dir):
                    for file_name in files:
                        files_seen.add(os.path.join(root, file_name))

        for file_path in sorted(files_seen):
            file_size = os.path.getsize(file_path)
            info['files'].append({
                'name': _rel_to_data(file_path),
                'size': file_size,
                'size_mb': round(file_size / (1024 * 1024), 2)
            })

        info['total_files'] = len(info['files'])
        info['total_size_mb'] = round(sum(f['size'] for f in info['files']) / (1024 * 1024), 2)

        return jsonify(info), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500
