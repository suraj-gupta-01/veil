from fastapi.testclient import TestClient

from app.guard import luhn, scan, verhoeff
from app.main import app

client = TestClient(app)


def session():
    r = client.post("/v1/session", json={})
    assert r.status_code == 200
    body = r.json()
    return body["session_id"], {"authorization": f"Bearer {body['token']}"}


def el(id, role, label, **kw):
    return {"id": id, "role": role, "label": label, "bbox": [0, 0, 10, 10], **kw}


def payload(sid, elements, entities=None, texts=None, mode="structure"):
    return {
        "session_id": sid, "vrs_version": "1.0", "goal": "Open a savings account", "step": 1, "mode": mode,
        "screen": {
            "origin": "http://localhost:5500", "path_template": "/bank-form.html", "title": "Open account",
            "state": {"class": "form", "confidence": 0.6, "src": "heuristic"}, "viewport": [1280, 720],
            "elements": elements, "texts": texts or [],
        },
        "entities": entities if entities is not None else [
            {"token": "⟦NAME_1⟧", "class": "NAME", "group": "PERSON", "source": "http://localhost:5500"},
            {"token": "⟦AADHAAR_1⟧", "class": "AADHAAR", "group": "GOV_ID", "format": "#### #### ####", "valid_checksum": True},
        ],
        "history": [],
    }


FORM = [
    el(1, "textbox", "Full name", value="", field_class="NAME", required=True),
    el(2, "textbox", "Aadhaar number", value="", field_class="AADHAAR", required=True),
    el(3, "button", "Continue"),
]


def test_checksums():
    assert verhoeff("4821 6630 1979") and not verhoeff("4821 6630 1978")
    assert luhn("4111111111111111") and not luhn("4111111111111112")


def test_guard_ignores_tokens_and_image():
    assert scan({"a": "⟦AADHAAR_1⟧", "image": "4821 6630 1979"}) == []
    hits = scan({"screen": {"texts": [{"text": "Aadhaar 4821 6630 1979"}]}})
    assert hits[0].cls == "AADHAAR" and hits[0].path == "screen.texts[0].text"


def test_fill_then_continue():
    sid, h = session()
    r = client.post("/v1/step", json=payload(sid, FORM), headers=h)
    assert r.status_code == 200, r.text
    acts = r.json()["actions"]
    assert acts[:2] == [
        {"type": "type", "target": 1, "text": "⟦NAME_1⟧"},
        {"type": "type", "target": 2, "text": "⟦AADHAAR_1⟧"},
    ]
    assert acts[2] == {"type": "click", "target": 3, "requires_confirmation": False}


def test_secret_fields_go_to_user():
    sid, h = session()
    form = FORM[:1] + [el(4, "password", "Password", value="", field_class="SECRET"), el(5, "button", "Submit application")]
    acts = client.post("/v1/step", json=payload(sid, form), headers=h).json()["actions"]
    assert acts[0]["type"] == "type"
    assert acts[1]["type"] == "ask_user" and acts[1]["target"] == 4


def test_irreversible_click_is_flagged():
    sid, h = session()
    form = [el(1, "textbox", "Full name", value="⟦NAME_1⟧", field_class="NAME"), el(5, "button", "Submit application")]
    acts = client.post("/v1/step", json=payload(sid, form), headers=h).json()["actions"]
    assert acts == [{"type": "click", "target": 5, "requires_confirmation": True}]


def test_loop_guard():
    sid, h = session()
    form = [el(1, "textbox", "Full name", value="⟦NAME_1⟧", field_class="NAME"), el(3, "button", "Continue")]
    client.post("/v1/step", json=payload(sid, form), headers=h)
    r = client.post("/v1/step", json=payload(sid, form), headers=h).json()
    assert r["done"] is True


def test_raw_pii_is_rejected():
    sid, h = session()
    bad = payload(sid, FORM, texts=[{"id": 9, "text": "PAN ABCPR1234K", "bbox": [0, 0, 1, 1]}])
    r = client.post("/v1/step", json=bad, headers=h)
    assert r.status_code == 422
    assert r.json()["detail"]["leaks"] == [{"path": "screen.texts[0].text", "class": "PAN"}]


def test_auth_and_schema():
    sid, _ = session()
    assert client.post("/v1/step", json=payload(sid, FORM), headers={"authorization": "Bearer nope"}).status_code == 401
    sid, h = session()
    bad = payload(sid, FORM)
    bad["screen"]["surprise"] = 1
    assert client.post("/v1/step", json=bad, headers=h).status_code == 422
    assert client.post("/v1/step", json=payload(sid, FORM, mode="pixel"), headers=h).status_code == 400


def test_session_delete():
    sid, h = session()
    assert client.delete(f"/v1/session/{sid}", headers=h).status_code == 200
    assert client.post("/v1/step", json=payload(sid, FORM), headers=h).status_code == 401
