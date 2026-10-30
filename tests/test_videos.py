import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import live_server as ls  # noqa: E402


@pytest.mark.parametrize("header,size,expected", [
    (None, 100, None),
    ("bytes=0-9", 100, (0, 9)),
    ("bytes=10-", 100, (10, 99)),
    ("bytes=90-500", 100, (90, 99)),
    ("bytes=-20", 100, (80, 99)),
    ("bytes=-500", 100, (0, 99)),
])
def test_parse_range_ok(header, size, expected):
    assert ls.parse_range(header, size) == expected


@pytest.mark.parametrize("header", ["bytes=100-", "bytes=5-2", "bytes=a-b", "items=0-1", "bytes=0-1,5-6", "bytes=-0"])
def test_parse_range_invalid(header):
    with pytest.raises(ValueError):
        ls.parse_range(header, 100)


@pytest.fixture
def server(tmp_path, monkeypatch):
    vdir = tmp_path / "videos"
    vdir.mkdir()
    (vdir / "calma.mp4").write_bytes(bytes(range(256)) * 4)
    (vdir / "notas.txt").write_text("no es video")
    (tmp_path / "secreto.txt").write_text("no debe salir")
    monkeypatch.setattr(ls, "VIDEO_DIR", vdir)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), ls.PageHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), b""


def test_lista_solo_videos(server):
    status, _, body = get(server + "/videos.json")
    assert status == 200 and body == b'["calma.mp4"]'


def test_video_completo_y_rango(server):
    status, h, body = get(server + "/videos/calma.mp4")
    assert status == 200 and len(body) == 1024 and h["Accept-Ranges"] == "bytes"
    status, h, body = get(server + "/videos/calma.mp4", {"Range": "bytes=0-1"})
    assert status == 206 and body == b"\x00\x01" and h["Content-Range"] == "bytes 0-1/1024"
    status, _, body = get(server + "/videos/calma.mp4", {"Range": "bytes=1000-"})
    assert status == 206 and len(body) == 24
    status, _, _ = get(server + "/videos/calma.mp4", {"Range": "bytes=5000-"})
    assert status == 416


def test_no_sirve_otros_archivos(server):
    assert get(server + "/videos/notas.txt")[0] == 404
    assert get(server + "/videos/..%2Fsecreto.txt")[0] == 404
    assert get(server + "/videos/../secreto.txt")[0] == 404
    assert get(server + "/videos/inexistente.mp4")[0] == 404
