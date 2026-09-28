import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURE = Path(__file__).resolve().parents[2] / "contracts" / "step_request.json"


@pytest.mark.skipif(not FIXTURE.exists(), reason="run `npm test` in extension/ first to generate the fixture")
def test_extension_payload_round_trips():
    client = TestClient(app)
    s = client.post("/v1/session", json={}).json()
    req = json.loads(FIXTURE.read_text(encoding="utf-8"))
    req["session_id"] = s["session_id"]
    r = client.post("/v1/step", json=req, headers={"authorization": f"Bearer {s['token']}"})
    assert r.status_code == 200, r.text
    assert r.json()["actions"] == [
        {"type": "type", "target": 1, "text": "⟦NAME_1⟧"},
        {"type": "type", "target": 2, "text": "⟦AADHAAR_1⟧"},
        {"type": "click", "target": 3, "requires_confirmation": False},
    ]
