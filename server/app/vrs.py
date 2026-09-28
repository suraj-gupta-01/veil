import re
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

VRS_VERSION = "1.0"
TOKEN_RE = re.compile(r"⟦([A-Z_]+?)_(\d+)⟧")

TokenClass = Literal[
    "SECRET", "AADHAAR", "PAN", "PASSPORT", "VOTER_ID", "CARD", "ACCOUNT", "IFSC", "UPI",
    "EMAIL", "PHONE", "ADDRESS", "USERNAME", "NAME", "DOB", "FACE", "SIGNATURE", "QR", "IMAGE", "CUSTOM",
]
ClassGroup = Literal["SECRET", "GOV_ID", "FINANCIAL", "CONTACT", "PERSON", "BIOMETRIC", "ENCODED", "RASTER", "CUSTOM"]
Role = Literal["textbox", "password", "checkbox", "radio", "combobox", "button", "link", "image", "other"]
BBox = tuple[float, float, float, float]


class Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class Element(Model):
    id: int
    role: Role
    label: str = ""
    value: Optional[str] = None
    placeholder: Optional[str] = None
    field_class: Optional[TokenClass] = None
    required: bool = False
    disabled: bool = False
    checked: Optional[bool] = None
    options: Optional[list[str]] = None
    masked: bool = False
    bbox: BBox
    src: Literal["dom", "vision"] = "dom"


class Text(Model):
    id: int
    text: str
    bbox: BBox


class ScreenState(Model):
    cls: str = Field(alias="class")
    confidence: float
    src: Literal["heuristic", "vit"] = "heuristic"


class Screen(Model):
    origin: str
    path_template: str
    title: str = ""
    state: ScreenState
    viewport: tuple[int, int]
    image: Optional[str] = None
    elements: list[Element]
    texts: list[Text] = []


class Entity(Model):
    token: str
    cls: TokenClass = Field(alias="class")
    group: ClassGroup
    format: Optional[str] = None
    valid_checksum: Optional[bool] = None
    source: Optional[str] = None


class HistoryItem(Model):
    step: int
    summary: str


class StepRequest(Model):
    session_id: str
    vrs_version: str
    goal: str
    step: int
    mode: Literal["pixel", "structure"]
    screen: Screen
    entities: list[Entity] = []
    history: list[HistoryItem] = []


class Click(Model):
    type: Literal["click"] = "click"
    target: int
    requires_confirmation: bool = False


class TypeText(Model):
    type: Literal["type"] = "type"
    target: int
    text: str


class Select(Model):
    type: Literal["select"] = "select"
    target: int
    option: str


class Scroll(Model):
    type: Literal["scroll"] = "scroll"
    direction: Literal["up", "down"]
    amount: Optional[int] = None


class Key(Model):
    type: Literal["key"] = "key"
    key: str
    target: Optional[int] = None


class Wait(Model):
    type: Literal["wait"] = "wait"
    ms: int


class AskUser(Model):
    type: Literal["ask_user"] = "ask_user"
    message: str
    target: Optional[int] = None


class Done(Model):
    type: Literal["done"] = "done"
    message: Optional[str] = None


Action = Annotated[Union[Click, TypeText, Select, Scroll, Key, Wait, AskUser, Done], Field(discriminator="type")]


class StepResponse(Model):
    actions: list[Action]
    rationale: str
    done: bool = False


class SessionRequest(Model):
    client: str = "veil-extension"
    vrs_version: str = VRS_VERSION


class SessionResponse(Model):
    session_id: str
    token: str
    vrs_version: str = VRS_VERSION
    max_steps: int = 25
