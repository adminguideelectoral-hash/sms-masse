#!/usr/bin/env python3
"""Pont local entre une interface web et kdeconnect-cli.

Dépendances : bibliothèque standard Python uniquement.
Écoute sur 127.0.0.1 seulement.
"""

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8762
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

CLI = shutil.which("kdeconnect-cli")

NUMBER_RE = re.compile(r"^\+?\d{6,15}$")
DEVICE_LINE_RE = re.compile(r"^-\s+(?P<name>.*?):\s+(?P<id>\S+)\s+on\s+\S+\s+via\s+\S+\s+\((?P<state>.*)\)$")

MAX_MESSAGE_LEN = 2000
MAX_RECIPIENTS = 1000
SEND_TIMEOUT = 30

JOBS = {}
JOBS_LOCK = threading.Lock()


def list_devices():
    if not CLI:
        raise RuntimeError("kdeconnect-cli introuvable dans le PATH")
    proc = subprocess.run([CLI, "-l"], capture_output=True, text=True, timeout=15)
    devices = []
    for line in proc.stdout.splitlines():
        match = DEVICE_LINE_RE.match(line.strip())
        if not match:
            continue
        state = match.group("state")
        devices.append(
            {
                "id": match.group("id"),
                "name": match.group("name"),
                "paired": "paired" in state,
                "reachable": "reachable" in state,
                "state": state,
            }
        )
    return devices


def normalize_numbers(raw_numbers, default_prefix=""):
    seen = set()
    valid = []
    rejected = []
    cc = re.sub(r"\D", "", default_prefix or "")
    for item in raw_numbers:
        num = re.sub(r"[\s.\-()/]", "", str(item).strip())
        if not num:
            continue
        if not num.startswith("+") and cc:
            if num.startswith(cc) and len(num) - len(cc) >= 6:
                num = "+" + num
            else:
                num = "+" + cc + num
        if NUMBER_RE.match(num):
            if num not in seen:
                seen.add(num)
                valid.append(num)
        else:
            rejected.append(str(item).strip())
    return valid, rejected


def run_job(job_id, device_id, message, numbers, delay, dry_run):
    with JOBS_LOCK:
        job = JOBS[job_id]

    for num in numbers:
        if job["cancel"]:
            break
        entry = {"number": num, "ok": False, "error": ""}
        if dry_run:
            entry["ok"] = True
            entry["error"] = "simulation"
        else:
            try:
                proc = subprocess.run(
                    [CLI, "-d", device_id, "--send-sms", message, "--destination", num],
                    capture_output=True,
                    text=True,
                    timeout=SEND_TIMEOUT,
                )
                entry["ok"] = proc.returncode == 0
                if not entry["ok"]:
                    entry["error"] = (proc.stderr or proc.stdout or "").strip()[:300]
            except subprocess.TimeoutExpired:
                entry["error"] = f"timeout après {SEND_TIMEOUT}s"
            except Exception as exc:
                entry["error"] = str(exc)[:300]
        with JOBS_LOCK:
            job["results"].append(entry)
            job["done"] += 1
        time.sleep(delay)

    with JOBS_LOCK:
        job["status"] = "cancelled" if job["cancel"] else "done"
        job["finished_at"] = time.time()


class Handler(BaseHTTPRequestHandler):
    server_version = "SMSBridge/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, rel_path, content_type):
        path = os.path.join(STATIC_DIR, rel_path)
        if not os.path.isfile(path):
            self._send_json({"error": "not found"}, 404)
            return
        with open(path, "rb") as handle:
            body = handle.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send_file("index.html", "text/html; charset=utf-8")
        elif self.path == "/style.css":
            self._send_file("style.css", "text/css; charset=utf-8")
        elif self.path == "/app.js":
            self._send_file("app.js", "application/javascript; charset=utf-8")
        elif self.path == "/api/devices":
            try:
                self._send_json({"devices": list_devices(), "cli": CLI or ""})
            except Exception as exc:
                self._send_json({"error": str(exc)}, 500)
        elif self.path.startswith("/api/job/"):
            job_id = self.path.rsplit("/", 1)[-1]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    self._send_json({"error": "job inconnu"}, 404)
                    return
                snapshot = {
                    "status": job["status"],
                    "total": job["total"],
                    "done": job["done"],
                    "results": list(job["results"]),
                }
            self._send_json(snapshot)
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 5_000_000:
            self._send_json({"error": "payload trop volumineux"}, 413)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send_json({"error": "JSON invalide"}, 400)
            return

        if self.path == "/api/send":
            self._handle_send(payload)
        elif self.path.startswith("/api/cancel/"):
            job_id = self.path.rsplit("/", 1)[-1]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if job:
                    job["cancel"] = True
            self._send_json({"ok": bool(job)})
        else:
            self._send_json({"error": "not found"}, 404)

    def _handle_send(self, payload):
        if not CLI:
            self._send_json({"error": "kdeconnect-cli introuvable dans le PATH"}, 500)
            return

        device_id = str(payload.get("device_id") or "").strip()
        message = str(payload.get("message") or "")
        numbers = payload.get("numbers") or []
        default_prefix = str(payload.get("default_prefix") or "+1")
        dry_run = bool(payload.get("dry_run"))
        try:
            delay = float(payload.get("delay", 1))
        except (TypeError, ValueError):
            delay = 1.0
        delay = max(0.0, min(delay, 60.0))

        if not device_id:
            self._send_json({"error": "aucun appareil sélectionné"}, 400)
            return
        if not message.strip():
            self._send_json({"error": "message vide"}, 400)
            return
        if len(message) > MAX_MESSAGE_LEN:
            self._send_json({"error": f"message trop long (max {MAX_MESSAGE_LEN})"}, 400)
            return
        if not isinstance(numbers, list) or not numbers:
            self._send_json({"error": "aucun destinataire"}, 400)
            return

        try:
            known_ids = {d["id"] for d in list_devices()}
        except Exception as exc:
            self._send_json({"error": f"impossible de lister les appareils : {exc}"}, 500)
            return
        if device_id not in known_ids:
            self._send_json({"error": "appareil inconnu"}, 400)
            return

        valid, rejected = normalize_numbers(numbers, default_prefix)
        if not valid:
            self._send_json({"error": "aucun numéro valide"}, 400)
            return
        if len(valid) > MAX_RECIPIENTS:
            self._send_json({"error": f"trop de destinataires (max {MAX_RECIPIENTS})"}, 400)
            return

        job_id = uuid.uuid4().hex
        with JOBS_LOCK:
            JOBS[job_id] = {
                "status": "running",
                "total": len(valid),
                "done": 0,
                "results": [],
                "cancel": False,
                "started_at": time.time(),
            }

        thread = threading.Thread(
            target=run_job,
            args=(job_id, device_id, message, valid, delay, dry_run),
            daemon=True,
        )
        thread.start()

        self._send_json({"job_id": job_id, "total": len(valid), "rejected": rejected})

def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print(f"SMS Bridge démarré sur {url}")
    if not CLI:
        print("ATTENTION : kdeconnect-cli introuvable dans le PATH")
    print("Ctrl+C pour arrêter")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
