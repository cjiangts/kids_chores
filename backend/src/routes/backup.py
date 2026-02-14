"""Backup and restore routes"""
from flask import Blueprint, send_file, request, jsonify
import os
import zipfile
import tempfile
from datetime import datetime
import shutil

backup_bp = Blueprint('backup', __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data')

@backup_bp.route('/backup/download', methods=['GET'])
def download_backup():
    """Create a zip of all data and send it for download"""
    try:
        # Create temporary zip file
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        temp_dir = tempfile.mkdtemp()
        zip_path = os.path.join(temp_dir, f'kids_learning_backup_{timestamp}.zip')

        # Create zip file
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Add all files from data directory
            if os.path.exists(DATA_DIR):
                for root, dirs, files in os.walk(DATA_DIR):
                    for file in files:
                        file_path = os.path.join(root, file)
                        # Add to zip with relative path
                        arcname = os.path.relpath(file_path, DATA_DIR)
                        zipf.write(file_path, arcname)

        # Send file
        return send_file(
            zip_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f'kids_learning_backup_{timestamp}.zip'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@backup_bp.route('/backup/restore', methods=['POST'])
def restore_backup():
    """Restore data from uploaded zip file"""
    try:
        # Check if file was uploaded
        if 'backup' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400

        file = request.files['backup']

        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        if not file.filename.endswith('.zip'):
            return jsonify({'error': 'File must be a zip file'}), 400

        # Save uploaded file temporarily
        temp_dir = tempfile.mkdtemp()
        zip_path = os.path.join(temp_dir, 'backup.zip')
        file.save(zip_path)

        # Create backup of current data before restoring
        backup_dir = os.path.join(temp_dir, 'backup_before_restore')
        if os.path.exists(DATA_DIR):
            shutil.copytree(DATA_DIR, backup_dir)

        # Ensure data directory exists
        os.makedirs(DATA_DIR, exist_ok=True)

        # Extract zip to data directory
        with zipfile.ZipFile(zip_path, 'r') as zipf:
            zipf.extractall(DATA_DIR)

        # Clean up temp files
        shutil.rmtree(temp_dir)

        return jsonify({
            'success': True,
            'message': 'Backup restored successfully'
        }), 200

    except Exception as e:
        # If restore fails, try to restore the backup we made
        try:
            if 'backup_dir' in locals() and os.path.exists(backup_dir):
                if os.path.exists(DATA_DIR):
                    shutil.rmtree(DATA_DIR)
                shutil.copytree(backup_dir, DATA_DIR)
        except:
            pass

        return jsonify({'error': f'Restore failed: {str(e)}'}), 500

@backup_bp.route('/backup/info', methods=['GET'])
def backup_info():
    """Get information about current data"""
    try:
        info = {
            'data_dir_exists': os.path.exists(DATA_DIR),
            'files': []
        }

        if os.path.exists(DATA_DIR):
            for root, dirs, files in os.walk(DATA_DIR):
                for file in files:
                    file_path = os.path.join(root, file)
                    file_size = os.path.getsize(file_path)
                    info['files'].append({
                        'name': file,
                        'size': file_size,
                        'size_mb': round(file_size / (1024 * 1024), 2)
                    })

        info['total_files'] = len(info['files'])
        info['total_size_mb'] = round(sum(f['size'] for f in info['files']) / (1024 * 1024), 2)

        return jsonify(info), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500
