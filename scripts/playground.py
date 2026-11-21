#!/usr/bin/env python3
"""Build and serve Adiosbox on loopback with a server-side OpenRouter key."""

import http.client
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = 1313
ADDRESS = f"{HOST}:{PORT}"
LOCALHOST_ALIAS = f"localhost:{PORT}"
ORIGIN = f"http://{ADDRESS}"
MODEL_ID = re.compile(r"[\w.-]+/[\w.:@+-]+", re.ASCII)
MAX_REQUEST = 64 * 1024
MAX_RESPONSE = 2 * 1024 * 1024


def load_key(path):
    value = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not value and path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            name, separator, raw_value = line.partition("=")
            if separator and name.strip() == "OPENROUTER_API_KEY":
                value = raw_value.strip()
                if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
                    value = value[1:-1]
    if not re.fullmatch(r"[!-~]{1,512}", value):
        raise ValueError("Set OPENROUTER_API_KEY in the project's .env file, then restart.")
    return value


def completion_request(payload):
    """Only relay the fields this text playground uses."""
    if not isinstance(payload, dict):
        raise ValueError
    model = payload.get("model")
    if not isinstance(model, str) or len(model) > 200 or not MODEL_ID.fullmatch(model):
        raise ValueError
    messages = payload.get("messages")
    if not isinstance(messages, list) or len(messages) != 2:
        raise ValueError
    clean_messages = []
    for message, role, limit in zip(messages, ("system", "user"), (4000, 8000)):
        if not isinstance(message, dict) or message.get("role") != role:
            raise ValueError
        content = message.get("content")
        if not isinstance(content, str) or not content.strip() or len(content) > limit:
            raise ValueError
        clean_messages.append({"role": role, "content": content})
    cleaned = {"model": model, "messages": clean_messages, "max_tokens": 650, "stream": False}
    usage = payload.get("usage")
    if isinstance(usage, dict) and usage.get("include") is True:
        cleaned["usage"] = {"include": True}
    return cleaned


def complete(api_key, payload):
    connection = http.client.HTTPSConnection("openrouter.ai", timeout=50)
    try:
        connection.request(
            "POST", "/api/v1/chat/completions", body=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        response = connection.getresponse()
        if response.status != 200:
            return response.status if 400 <= response.status < 600 else 502, b"{}"
        body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            return 502, b"{}"
        return 200, body
    except TimeoutError:
        return 504, b"{}"
    except (OSError, http.client.HTTPException):
        return 502, b"{}"
    finally:
        connection.close()


class PlaygroundHandler(SimpleHTTPRequestHandler):
    timeout = 10

    def __init__(self, *args, directory, api_key):
        self.api_key = api_key
        super().__init__(*args, directory=directory)

    def log_message(self, format, *args):
        pass

    def list_directory(self, path):
        self.send_error(404)
        return None

    def send_head(self):
        hosts = self.headers.get_all("Host")
        if hosts == [LOCALHOST_ALIAS]:
            path = quote(self.path.lstrip("/"), safe="/%?=&:+,;@")
            self.send_response(302)
            self.send_header("Location", f"{ORIGIN}/{path}")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        if hosts != [ADDRESS]:
            self.send_error(403)
            return None
        return super().send_head()

    def do_POST(self):
        if self.path != "/api/complete":
            self.send_error(404)
            return
        if self.headers.get_all("Host") != [ADDRESS] or self.headers.get_all("Origin") != [ORIGIN]:
            self.send_error(403)
            return
        if self.headers.get_content_type() != "application/json" or self.headers.get("Transfer-Encoding"):
            self.send_error(415)
            return
        lengths = self.headers.get_all("Content-Length", [])
        try:
            if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdecimal():
                raise ValueError
            length = int(lengths[0])
            if length > MAX_REQUEST:
                self.send_error(413)
                return
            payload = completion_request(json.loads(self.rfile.read(length)))
        except (ValueError, RecursionError):
            self.send_error(400)
            return
        except TimeoutError:
            self.send_error(408)
            return

        status, body = complete(self.api_key, payload)
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # The browser canceled while OpenRouter was still working.


def main():
    try:
        if not (ROOT / "node_modules/@langchain/langgraph/package.json").is_file():
            raise ValueError("Install LangGraph once with: npm ci --ignore-scripts")
        api_key = load_key(ROOT / ".env")
        build_env = {name: value for name, value in os.environ.items() if name != "OPENROUTER_API_KEY"}
        with tempfile.TemporaryDirectory(prefix="adiosbox-") as site:
            subprocess.run(
                ["hugo", "--panicOnWarning", "--environment", "local",
                 "--baseURL", f"{ORIGIN}/", "--destination", site],
                cwd=ROOT, env=build_env, check=True, stdout=subprocess.DEVNULL,
            )
            handler = partial(PlaygroundHandler, directory=site, api_key=api_key)
            with ThreadingHTTPServer((HOST, PORT), handler) as server:
                print(f"Adiosbox is ready at {ORIGIN}/. Press Ctrl+C to stop.", flush=True)
                server.serve_forever()
    except KeyboardInterrupt:
        return 0
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Adiosbox could not start: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
