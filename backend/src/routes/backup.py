"""Backup and restore routes (super-family scoped, full-data)."""
from flask import Blueprint, send_file, request, jsonify, session
import os
import zipfile
import tempfile
from datetime import datetime
import shutil
import json
from src.db import metadata

backup_bp = Blueprint('backup', __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data')
FULL_BACKUP_MANIFEST = 'full_manifest.json'


def _normalize_rel_path(path_value):
    """Normalize a relative path to forward-slash form without leading slash."""
    normalized = os.path.normpath(str(path_value or '')).replace('\\', '/')
    while normalized.startswith('./'):
        normalized = normalized[2:]
    if normalized == '.':
        return ''
    return normalized.lstrip('/')


def _current_family_id():
    return str(session.get('family_id') or '')


def _require_super_family():
    """Require authenticated super family."""
    family_id = _current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401
    if not metadata.is_super_family(family_id):
        return jsonify({'error': 'Super family access required'}), 403
    return None


def _require_critical_password():
    """Require family password confirmation for critical backup operations."""
    family_id = _current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401

    password = str(request.headers.get('X-Confirm-Password') or '')
    if not password:
        password = str(request.form.get('confirmPassword') or '')
    if not password:
        json_data = request.get_json(silent=True)
        if isinstance(json_data, dict):
            password = str(json_data.get('confirmPassword') or '')
    if not password:
        return jsonify({'error': 'Password confirmation required'}), 400
    if not metadata.verify_family_password(family_id, password):
        return jsonify({'error': 'Invalid password'}), 403
    return None


def _is_safe_backup_rel_path(path_value):
    """Validate zip member path for safe extraction inside DATA_DIR."""
    normalized = _normalize_rel_path(path_value)
    if not normalized:
        return False
    if normalized.startswith('../') or normalized == '..':
        return False
    if normalized.startswith('/'):
        return False
    return True


def _iter_data_files():
    """Yield normalized file paths relative to DATA_DIR."""
    if not os.path.exists(DATA_DIR):
        return []
    files = []
    for root, _, names in os.walk(DATA_DIR):
        for name in names:
            abs_path = os.path.join(root, name)
            rel_path = _normalize_rel_path(os.path.relpath(abs_path, DATA_DIR))
            if _is_safe_backup_rel_path(rel_path):
                files.append(rel_path)
    return sorted(set(files))


def _clear_directory_contents(target_dir):
    """Delete all children in one directory while keeping the directory."""
    if not os.path.isdir(target_dir):
        os.makedirs(target_dir, exist_ok=True)
        return
    for entry in os.listdir(target_dir):
        entry_path = os.path.join(target_dir, entry)
        if os.path.isdir(entry_path):
            shutil.rmtree(entry_path, ignore_errors=True)
        else:
            try:
                os.remove(entry_path)
            except FileNotFoundError:
                pass

@backup_bp.route('/backup/download', methods=['GET'])
def download_backup():
    """Create a full data backup zip (super family only)."""
    try:
        auth_err = _require_super_family()
        if auth_err:
            return auth_err

        # Create temporary zip file
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        temp_dir = tempfile.mkdtemp()
        zip_path = os.path.join(temp_dir, f'kids_learning_full_backup_{timestamp}.zip')
        files_to_include = _iter_data_files()

        manifest = {
            'scope': 'full_data',
            'manifest_version': 1,
            'created_by_family_id': _current_family_id(),
            'files': files_to_include,
            'exported_at': datetime.now().isoformat(),
        }

        # Create zip file
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            zipf.writestr(FULL_BACKUP_MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2))
            for rel_path in manifest['files']:
                abs_path = os.path.join(DATA_DIR, rel_path)
                if os.path.exists(abs_path):
                    zipf.write(abs_path, rel_path)

        # Send file
        return send_file(
            zip_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f'kids_learning_full_backup_{timestamp}.zip'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@backup_bp.route('/backup/restore', methods=['POST'])
def restore_backup():
    """Restore full data directory from a super backup zip."""
    temp_dir = None
    try:
        super_err = _require_super_family()
        if super_err:
            return super_err
        auth_err = _require_critical_password()
        if auth_err:
            return auth_err

        # Check if file was uploaded
        if 'backup' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400

        file = request.files['backup']

        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        if not file.filename.endswith('.zip'):
            return jsonify({'error': 'File must be a zip file'}), 400

        # Save uploaded file temporarily.
        temp_dir = tempfile.mkdtemp(prefix='full_restore_')
        zip_path = os.path.join(temp_dir, 'backup.zip')
        file.save(zip_path)

        # Ensure data directory exists.
        os.makedirs(DATA_DIR, exist_ok=True)

        with zipfile.ZipFile(zip_path, 'r') as zipf:
            if FULL_BACKUP_MANIFEST not in zipf.namelist():
                return jsonify({'error': 'Invalid backup format: missing full manifest'}), 400
            manifest = json.loads(zipf.read(FULL_BACKUP_MANIFEST).decode('utf-8'))
            if str(manifest.get('scope') or '') != 'full_data':
                return jsonify({'error': 'Invalid backup format: not a full-data backup'}), 400

            files_from_backup = manifest.get('files') or []
            if not isinstance(files_from_backup, list):
                return jsonify({'error': 'Invalid backup format: files must be a list'}), 400

            stage_data_dir = os.path.join(temp_dir, 'stage_data')
            os.makedirs(stage_data_dir, exist_ok=True)

            for raw_path in files_from_backup:
                rel_path = _normalize_rel_path(raw_path)
                if not _is_safe_backup_rel_path(rel_path):
                    return jsonify({'error': f'Invalid backup path: {raw_path}'}), 400
                if rel_path not in zipf.namelist():
                    return jsonify({'error': f'Backup is missing file: {rel_path}'}), 400
                target_abs = os.path.join(stage_data_dir, rel_path)
                os.makedirs(os.path.dirname(target_abs), exist_ok=True)
                with zipf.open(rel_path) as src, open(target_abs, 'wb') as dst:
                    shutil.copyfileobj(src, dst)

        _clear_directory_contents(DATA_DIR)
        for root, _, files in os.walk(stage_data_dir):
            for file_name in files:
                src_abs = os.path.join(root, file_name)
                rel_path = os.path.relpath(src_abs, stage_data_dir)
                target_abs = os.path.join(DATA_DIR, rel_path)
                os.makedirs(os.path.dirname(target_abs), exist_ok=True)
                shutil.copy2(src_abs, target_abs)

        metadata.ensure_metadata_file()

        return jsonify({
            'success': True,
            'message': 'Full backup restored successfully'
        }), 200

    except Exception as e:
        return jsonify({'error': f'Restore failed: {str(e)}'}), 500
    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)

@backup_bp.route('/backup/info', methods=['GET'])
def backup_info():
    """Get full backup information for super family."""
    try:
        auth_err = _require_super_family()
        if auth_err:
            return auth_err

        info = {
            'scope': 'full_data',
            'data_dir_exists': os.path.exists(DATA_DIR),
            'files': [],
            'family_id': _current_family_id(),
        }

        for rel_path in _iter_data_files():
            file_path = os.path.join(DATA_DIR, rel_path)
            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            info['files'].append({
                'name': rel_path,
                'size': file_size,
                'size_mb': round(file_size / (1024 * 1024), 2)
            })

        info['total_files'] = len(info['files'])
        info['total_size_mb'] = round(sum(f['size'] for f in info['files']) / (1024 * 1024), 2)

        return jsonify(info), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500
