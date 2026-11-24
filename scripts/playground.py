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
# Shared with the browser modules and Hugo templates.
LIMITS = json.loads((ROOT / "assets/limits.json").read_text(encoding="utf-8"))
HOST = "127.0.0.1"
PORT = 1313
ADDRESS = f"{HOST}:{PORT}"
LOCALHOST_ALIAS = f"localhost:{PORT}"
ORIGIN = f"http://{ADDRESS}"
MODEL_ID = re.compile(r"[\w.-]+/[\w.:@+-]+", re.ASCII)
PROVIDER_SLUG = re.compile(r"[a-z0-9][a-z0-9-]*(?:/[a-z0-9][a-z0-9-]*){0,2}", re.ASCII)
MAX_REQUEST = LIMITS["requestBytes"]
MAX_RESPONSE = 2 * 1024 * 1024
COMPLETION_TOKEN_LIMIT = LIMITS["completionTokens"]
REASONING_TOKEN_LIMIT = LIMITS["reasoningTokens"]
REASONING_COMPLETION_TOKEN_LIMIT = LIMITS["reasoningCompletionTokens"]
# Mirrors capsReasoning in assets/js/completion-options.js.
REASONING_CAPPED = set(LIMITS["reasoningCappedModels"])
MAX_RESPONSE_FORMAT = 4000


def caps_reasoning(model, payload):
    free = model == "openrouter/free" or model.endswith(":free")
    return model in REASONING_CAPPED or (free and "provider" not in payload)


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
    for message, role, limit in zip(messages, ("system", "user"), (LIMITS["promptChars"], LIMITS["inputChars"])):
        if not isinstance(message, dict) or message.get("role") != role:
            raise ValueError
        content = message.get("content")
        if not isinstance(content, str) or not content.strip() or len(content) > limit:
            raise ValueError
        clean_messages.append({"role": role, "content": content})
    cleaned = {
        "model": model, "messages": clean_messages, "max_tokens": COMPLETION_TOKEN_LIMIT, "stream": False,
    }
    if "reasoning" in payload:
        if not caps_reasoning(model, payload):
            raise ValueError
        tokens = payload["reasoning"].get("max_tokens") if isinstance(payload["reasoning"], dict) else None
        if payload["reasoning"] != {"max_tokens": tokens} or type(tokens) is not int or not 1 <= tokens <= REASONING_TOKEN_LIMIT:
            raise ValueError
        cleaned["reasoning"] = {"max_tokens": tokens}
        cleaned["max_tokens"] = REASONING_COMPLETION_TOKEN_LIMIT
    usage = payload.get("usage")
    if isinstance(usage, dict) and usage.get("include") is True:
        cleaned["usage"] = {"include": True}
    if "provider" in payload:
        only = payload["provider"].get("only") if isinstance(payload["provider"], dict) else None
        slug = only[0] if isinstance(only, list) and len(only) == 1 else None
        if (not isinstance(slug, str) or len(slug) > 100 or not PROVIDER_SLUG.fullmatch(slug) or
                payload["provider"] != {"only": [slug], "allow_fallbacks": False, "require_parameters": True}):
            raise ValueError
        cleaned["provider"] = {"only": [slug], "allow_fallbacks": False, "require_parameters": True}
    if "response_format" in payload:
        # The browser owns the schema; the launcher only pins it to one provider and bounds its size.
        response_format = payload["response_format"]
        if ("provider" not in cleaned or not isinstance(response_format, dict) or
                response_format.get("type") != "json_schema" or not isinstance(response_format.get("json_schema"), dict) or
                len(json.dumps(response_format)) > MAX_RESPONSE_FORMAT):
            raise ValueError
        cleaned["response_format"] = response_format
    return cleaned


def complete(api_key, payload):
    """Return the status and OpenRouter's body, or None when no body arrived."""
    connection = http.client.HTTPSConnection("openrouter.ai", timeout=50)
    try:
        connection.request(
            "POST", "/api/v1/chat/completions", body=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        response = connection.getresponse()
        body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            return 502, None
        status = response.status
        return status if status == 200 or 400 <= status < 600 else 502, body
    except TimeoutError:
        return 504, None
    except (OSError, http.client.HTTPException):
        return 502, None
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
        body = completion_trace(payload, body, self.api_key)
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("X-Adiosbox-Trace", "1")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # The browser canceled while OpenRouter was still working.


def completion_trace(payload, body, api_key):
    escaped_key = json.dumps(api_key)[1:-1]

    def redact(text):
        return text.replace(escaped_key, "[redacted]").replace(api_key, "[redacted]")

    return json.dumps({
        "request": redact(json.dumps(payload)),
        "response": redact(body.decode("utf-8", errors="replace")) if body is not None else None,
        "source": "OpenRouter" if body is not None else "local proxy",
    }).encode()


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
