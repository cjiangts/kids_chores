"""Main Flask application"""
from flask import Flask, send_from_directory
from flask_cors import CORS
import os

from src.routes.kids import kids_bp

def create_app():
    app = Flask(__name__)
    CORS(app)  # Enable CORS for React frontend

    # Register blueprints
    app.register_blueprint(kids_bp, url_prefix='/api')

    @app.route('/health', methods=['GET'])
    def health():
        return {'status': 'healthy'}, 200

    # Serve frontend files
    frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'frontend')

    @app.route('/')
    def index():
        return send_from_directory(frontend_dir, 'index.html')

    @app.route('/<path:path>')
    def serve_frontend(path):
        if os.path.exists(os.path.join(frontend_dir, path)):
            return send_from_directory(frontend_dir, path)
        return send_from_directory(frontend_dir, 'index.html')

    return app

if __name__ == '__main__':
    app = create_app()

    # Get port from environment variable (Railway sets PORT)
    port = int(os.environ.get('PORT', 5001))

    # Disable debug in production
    debug = os.environ.get('FLASK_ENV') != 'production'

    app.run(debug=debug, host='0.0.0.0', port=port)
