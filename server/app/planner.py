"""Planners turn a sanitized screen into actions. Phase 1 ships a deterministic rule planner so the
full client round trip can be exercised without a GPU. Phase 4 adds VLMPlanner behind the same interface."""
import re
from dataclasses import dataclass, field
from typing import Protocol

from .vrs import AskUser, Click, Done, StepRequest, StepResponse, TypeText

NON_FILLABLE = {"SECRET", "FACE", "SIGNATURE", "QR", "IMAGE"}
PRIMARY = re.compile(r"\b(continue|next|proceed|submit|save|verify|register|create account|apply|sign up|finish)\b", re.I)
IRREVERSIBLE = re.compile(r"\b(submit|pay|confirm|place order|send|delete|transfer|finish|apply)\b", re.I)


@dataclass
class Session:
    session_id: str
    token: str
    created: float
    last_seen: float
    steps: int = 0
    clicks: dict[str, int] = field(default_factory=dict)


class Planner(Protocol):
    async def plan(self, req: StepRequest, session: Session) -> StepResponse: ...


def screen_signature(req: StepRequest) -> str:
    labels = "|".join(f"{e.role}:{e.label}" for e in req.screen.elements[:40])
    return f"{req.screen.path_template}#{hash(labels)}"


class RulePlanner:
    async def plan(self, req: StepRequest, session: Session) -> StepResponse:
        first: dict[str, str] = {}
        for ent in req.entities:
            if ent.cls not in NON_FILLABLE:
                first.setdefault(ent.cls, ent.token)

        actions: list = []
        filled, pending_user = [], []
        for el in req.screen.elements:
            if el.role not in ("textbox", "password") or el.disabled or el.value:
                continue
            if el.field_class == "SECRET" or el.role == "password":
                pending_user.append(el)
            elif el.field_class and el.field_class in first:
                actions.append(TypeText(target=el.id, text=first[el.field_class]))
                filled.append(el.label or el.field_class)

        if pending_user:
            el = pending_user[0]
            actions.append(AskUser(target=el.id, message=f"Please enter your {el.label or 'secret'} yourself. VEIL never types secrets."))
            return StepResponse(actions=actions, rationale=self._why(filled, f"waiting for the user to fill “{el.label}”"))

        empty_required = [e for e in req.screen.elements if e.role == "textbox" and e.required and not e.value and not any(
            isinstance(a, TypeText) and a.target == e.id for a in actions)]
        buttons = [e for e in req.screen.elements if e.role == "button" and not e.disabled and PRIMARY.search(e.label)]
        sig = screen_signature(req)

        if buttons and not empty_required:
            btn = buttons[-1]
            key = f"{sig}:{btn.label}"
            if session.clicks.get(key, 0) >= 1 and not actions:
                return StepResponse(actions=[Done(message="The page did not change after the last click. Handing back to you.")],
                                    rationale="Stopped to avoid a loop.", done=True)
            session.clicks[key] = session.clicks.get(key, 0) + 1
            actions.append(Click(target=btn.id, requires_confirmation=bool(IRREVERSIBLE.search(btn.label))))
            return StepResponse(actions=actions, rationale=self._why(filled, f"then press “{btn.label}”"))

        if actions:
            missing = ", ".join(e.label or e.field_class or "field" for e in empty_required) or "none"
            return StepResponse(actions=actions, rationale=self._why(filled, f"still missing: {missing}"))

        if empty_required:
            names = ", ".join(e.label or "field" for e in empty_required[:4])
            return StepResponse(actions=[AskUser(target=empty_required[0].id, message=f"I don't have values for: {names}. Please fill them in.")],
                                rationale="Missing information the page requires.")
        return StepResponse(actions=[Done(message="Nothing left to fill on this page.")], rationale="No fillable fields or next step found.", done=True)

    @staticmethod
    def _why(filled: list[str], tail: str) -> str:
        return f"Fill {', '.join(filled)}; {tail}." if filled else f"{tail[0].upper()}{tail[1:]}."
