import time
import urllib.request
import urllib.error
import datetime

API_URL = 'http://172.21.0.10/sensor/data'


def get_token():
    """Return the configured auth token, or None if not configured."""
    try:
        with open('/app/token.txt', 'r') as f:
            tok = f.read().strip()
            return tok if tok else None
    except FileNotFoundError:
        return None


while True:
    try:
        token = get_token()
        req = urllib.request.Request(API_URL)
        if token:
            req.add_header('Authorization', f'Bearer {token}')
        with urllib.request.urlopen(req, timeout=3) as response:
            ts = datetime.datetime.utcnow().strftime('%H:%M:%S')
            print(f'[{ts}] Telemetry sent — HTTP {response.status}', flush=True)
    except urllib.error.HTTPError as e:
        ts = datetime.datetime.utcnow().strftime('%H:%M:%S')
        print(f'[{ts}] Telemetry error — HTTP {e.code} {e.reason}', flush=True)
    except Exception as e:
        ts = datetime.datetime.utcnow().strftime('%H:%M:%S')
        print(f'[{ts}] Telemetry error — {e}', flush=True)
    time.sleep(5)
