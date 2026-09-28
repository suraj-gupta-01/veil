import os
import secrets
import time

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .guard import scan
from .planner import RulePlanner, Session
from .vrs import TOKEN_RE, VRS_VERSION, SessionRequest, SessionResponse, StepRequest, StepResponse, TypeText

MAX_BODY = 2 * 1024 * 1024
SESSION_TTL = 15 * 60
MAX_STEPS = 25

app = FastAPI(title="VEIL server", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

sessions: dict[str, Session] = {}
planner = RulePlanner()


def purge() -> None:
    now = time.time()
    for sid in [k for k, s in sessions.items() if now - s.last_seen > SESSION_TTL]:
        del sessions[sid]


@app.middleware("http")
async def limit_body(request: Request, call_next):
    if int(request.headers.get("content-length") or 0) > MAX_BODY:
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Payload too large"}, status_code=413)
    return await call_next(request)


def auth(session_id: str, authorization: str | None) -> Session:
    purge()
    s = sessions.get(session_id)
    if not s or authorization != f"Bearer {s.token}":
        raise HTTPException(401, "Unknown session or bad token")
    s.last_seen = time.time()
    return s


@app.get("/healthz")
def healthz():
    return {"ok": True, "vrs_version": VRS_VERSION, "planner": type(planner).__name__, "sessions": len(sessions)}


@app.post("/v1/session", response_model=SessionResponse)
def create_session(body: SessionRequest):
    if body.vrs_version.split(".")[0] != VRS_VERSION.split(".")[0]:
        raise HTTPException(409, f"Server speaks VRS {VRS_VERSION}")
    purge()
    now = time.time()
    s = Session(session_id=f"s_{secrets.token_hex(4)}", token=secrets.token_urlsafe(24), created=now, last_seen=now)
    sessions[s.session_id] = s
    return SessionResponse(session_id=s.session_id, token=s.token, max_steps=MAX_STEPS)


@app.post("/v1/step", response_model=StepResponse, response_model_exclude_none=True)
async def step(req: StepRequest, authorization: str | None = Header(default=None)):
    s = auth(req.session_id, authorization)
    if req.vrs_version.split(".")[0] != VRS_VERSION.split(".")[0]:
        raise HTTPException(409, f"Server speaks VRS {VRS_VERSION}")
    leaks = scan(req.model_dump(by_alias=True))
    if leaks:
        raise HTTPException(422, {"error": "raw_pii", "leaks": [{"path": l.path, "class": l.cls} for l in leaks]})
    if req.mode == "pixel" and not req.screen.image:
        raise HTTPException(400, "Pixel mode requires an image")
    s.steps += 1
    if s.steps > MAX_STEPS:
        raise HTTPException(429, "Step limit reached")

    res = await planner.plan(req, s)

    ids = {e.id for e in req.screen.elements}
    known = {e.token for e in req.entities}
    for a in res.actions:
        if getattr(a, "target", None) is not None and a.target not in ids:
            raise HTTPException(500, f"Planner referenced unknown element {a.target}")
        if isinstance(a, TypeText):
            unknown = {m.group(0) for m in TOKEN_RE.finditer(a.text)} - known
            if unknown:
                raise HTTPException(500, f"Planner referenced unknown tokens {sorted(unknown)}")
    return res


@app.delete("/v1/session/{session_id}")
def end_session(session_id: str, authorization: str | None = Header(default=None)):
    auth(session_id, authorization)
    sessions.pop(session_id, None)
    return {"ok": True}
