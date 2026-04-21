from flask import Flask, request, jsonify
import random
import datetime

app = Flask(__name__)


def get_token():
    """Return the configured API token, or None if auth is not enabled."""
    try:
        with open('/app/token.txt', 'r') as f:
            tok = f.read().strip()
            return tok if tok else None
    except FileNotFoundError:
        return None


def check_auth():
    """Return True if the request is authorized (or auth is disabled)."""
    token = get_token()
    if token is None:
        return True  # Auth not enabled
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return False
    return auth_header[7:] == token


@app.route('/')
@app.route('/sensor/data')
def sensor_data():
    if not check_auth():
        return jsonify({'error': 'Unauthorized', 'hint': 'Include header: Authorization: Bearer <token>'}), 401
    data = {
        'sensor_id': 'S01',
        'temperature': round(20 + random.uniform(-2, 5), 1),
        'pressure': round(1013 + random.uniform(-5, 5), 1),
        'humidity': round(45 + random.uniform(-10, 10), 1),
        'status': 'nominal',
        'timestamp': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    }
    return jsonify(data)


@app.route('/health')
def health():
    token = get_token()
    return jsonify({'status': 'ok', 'auth_enabled': token is not None})


if __name__ == '__main__':
    token = get_token()
    if token:
        print(f'[*] IoT API starting — auth ENABLED (token: {token})')
    else:
        print('[*] IoT API starting — auth DISABLED (no /app/token.txt found)')
    app.run(host='0.0.0.0', port=80)
