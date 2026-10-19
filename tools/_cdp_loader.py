#!/usr/bin/env python3
"""
_cdp_loader.py — helper interno de 2-test-extension.sh

Habla con Chrome por el DevTools Protocol (CDP) para automatizar lo que,
a mano, serían varios clics en chrome://extensions:

  1. Activa "Developer mode" si está apagado (Chrome ya no permite cargar
     extensiones descomprimidas sin él, ni siquiera con --load-extension).
  2. Carga la extensión con el método oficial Extensions.loadUnpacked
     (el reemplazo moderno del flag de línea de comandos, que Chrome
     empezó a ignorar en versiones recientes si Developer mode está off).
  3. Abre la URL de prueba (por defecto, YouTube) en la misma pestaña.

No depende de ningún paquete externo (no hay 'websocket-client' ni
'websockets' instalados en este sistema): implementa a mano el handshake y
el framing de WebSocket (RFC 6455), lo justo para hablar con CDP.
"""
import base64
import hashlib
import json
import os
import struct
import socket
import sys
import time
import urllib.request


class CDP:
    def __init__(self, ws_url):
        assert ws_url.startswith("ws://"), ws_url
        rest = ws_url[len("ws://"):]
        host_port, path = rest.split("/", 1)
        path = "/" + path
        host, port = (host_port.split(":") + ["80"])[:2]
        port = int(port)

        self.sock = socket.create_connection((host, port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.sock.recv(4096)
            if not chunk:
                break
            data += chunk
        if b"101" not in data.split(b"\r\n", 1)[0]:
            raise RuntimeError(f"Handshake WebSocket fallido: {data[:200]!r}")

        self._id = 0
        self._buf = b""

    def _send_text_frame(self, text):
        payload = text.encode("utf-8")
        length = len(payload)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        if length <= 125:
            header = struct.pack("!BB", 0x81, 0x80 | length)
        elif length <= 65535:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, length)
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, length)
        self.sock.sendall(header + mask + masked)

    def _recv_exact(self, n):
        while len(self._buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("Conexión WebSocket cerrada")
            self._buf += chunk
        data, self._buf = self._buf[:n], self._buf[n:]
        return data

    def _recv_frame(self):
        b0, b1 = self._recv_exact(2)
        opcode = b0 & 0x0F
        masked = (b1 & 0x80) != 0
        length = b1 & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._recv_exact(8))[0]
        mask_key = self._recv_exact(4) if masked else None
        payload = self._recv_exact(length)
        if masked:
            payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        return opcode, payload

    def recv_json(self):
        _opcode, payload = self._recv_frame()
        return json.loads(payload.decode("utf-8"))

    def send(self, method, params=None):
        self._id += 1
        self._send_text_frame(json.dumps({"id": self._id, "method": method, "params": params or {}}))
        return self._id

    def call(self, method, params=None, timeout_msgs=200):
        my_id = self.send(method, params)
        for _ in range(timeout_msgs):
            msg = self.recv_json()
            if msg.get("id") == my_id:
                if "error" in msg:
                    raise RuntimeError(f"{method} -> {msg['error']}")
                return msg.get("result", {})
        raise TimeoutError(f"Sin respuesta a {method}")

    def close(self):
        self.sock.close()


def http_json(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.loads(r.read())


DEEP_QUERY_JS = """
function deepQuery(root, selector) {
  const direct = root.querySelector(selector);
  if (direct) return direct;
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      const found = deepQuery(el.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}
function deepQueryAll(root, selector) {
  let results = Array.from(root.querySelectorAll(selector));
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) results = results.concat(deepQueryAll(el.shadowRoot, selector));
  }
  return results;
}
"""


def wait_for_devtools(port, attempts=40, delay=0.5):
    for _ in range(attempts):
        try:
            return http_json(f"http://127.0.0.1:{port}/json/version")
        except Exception:
            time.sleep(delay)
    raise RuntimeError("El puerto de depuración de Chrome nunca respondió")


def get_first_page(port):
    tabs = http_json(f"http://127.0.0.1:{port}/json/list")
    page = next((t for t in tabs if t["type"] == "page"), None)
    if not page:
        raise RuntimeError("No se encontró ninguna pestaña abierta")
    return page


def ensure_developer_mode(c):
    """Activa 'Developer mode' en chrome://extensions si está apagado."""
    c.call("Page.navigate", {"url": "chrome://extensions/"})
    time.sleep(1.2)

    check_js = DEEP_QUERY_JS + """
    (function() {
      const t = deepQuery(document, '#devMode');
      if (!t) return JSON.stringify({found: false});
      const r = t.getBoundingClientRect();
      return JSON.stringify({found: true, checked: t.checked, x: r.x + r.width / 2, y: r.y + r.height / 2});
    })()
    """
    result = json.loads(c.call("Runtime.evaluate", {"expression": check_js, "returnByValue": True})["result"]["value"])
    if not result["found"]:
        raise RuntimeError("No se encontró el interruptor 'Developer mode' (¿cambió chrome://extensions?)")

    if result["checked"]:
        print("Developer mode ya estaba activado.")
        return

    cx, cy = result["x"], result["y"]
    c.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": cx, "y": cy})
    c.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": cx, "y": cy, "button": "left", "clickCount": 1})
    c.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": cx, "y": cy, "button": "left", "clickCount": 1})
    time.sleep(1)
    print("Developer mode activado.")


def main():
    port = int(sys.argv[1])
    root_dir = sys.argv[2]
    target_url = sys.argv[3]

    wait_for_devtools(port)
    time.sleep(1)
    page = get_first_page(port)

    c = CDP(page["webSocketDebuggerUrl"])
    c.call("Page.enable")
    c.call("Runtime.enable")

    ensure_developer_mode(c)

    ver = http_json(f"http://127.0.0.1:{port}/json/version")
    browser_c = CDP(ver["webSocketDebuggerUrl"])
    try:
        result = browser_c.call("Extensions.loadUnpacked", {"path": root_dir})
    except RuntimeError as err:
        print(f"ERROR: Extensions.loadUnpacked no funcionó ({err}).", file=sys.stderr)
        print("Tu versión de Chrome puede no soportar este método CDP.", file=sys.stderr)
        print("Carga la extensión a mano: chrome://extensions -> 'Cargar descomprimida'.", file=sys.stderr)
        sys.exit(1)
    ext_id = result["id"]
    browser_c.close()
    print(f"Super Video Downloader cargada. ID: {ext_id}")

    # Confirmar que no hay errores de manifest antes de seguir.
    c.call("Page.navigate", {"url": "chrome://extensions/"})
    time.sleep(1)
    check_js = DEEP_QUERY_JS + """
    (function() {
      const items = deepQueryAll(document, 'extensions-item');
      const sv = items.find(i => i.data && i.data.id === '%s');
      if (!sv) return JSON.stringify({found: false});
      return JSON.stringify({
        found: true,
        manifestErrors: (sv.data.manifestErrors || []).length,
        runtimeErrors: (sv.data.runtimeErrors || []).length
      });
    })()
    """ % ext_id
    info = json.loads(c.call("Runtime.evaluate", {"expression": check_js, "returnByValue": True})["result"]["value"])
    if info.get("found") and info.get("manifestErrors", 0) > 0:
        print(f"AVISO: la extensión tiene {info['manifestErrors']} error(es) de manifest. Revisa chrome://extensions.", file=sys.stderr)

    c.call("Page.navigate", {"url": target_url})
    time.sleep(1.5)

    # Recarga forzada: si esta es la primerísima navegación de la pestaña
    # justo después de Extensions.loadUnpacked, Chrome puede no haber
    # propagado todavía el registro del content script a tiempo para esa
    # navegación en concreto (el content script simplemente no se inyecta,
    # sin ningún error visible). Una recarga aquí garantiza que la página
    # quede con content.js/pip.js realmente activos antes de entregarle el
    # control al usuario.
    c.call("Page.reload")
    time.sleep(1)

    c.close()
    print(f"Abriendo: {target_url}")


if __name__ == "__main__":
    main()
