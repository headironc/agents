"""Bounded JSON input shared by the native Sketch command-line tools."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, BinaryIO, Dict, Optional, Union

MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_DOM_DICT_NODES = 30000
MAX_DOM_CONTAINER_ITEMS = 120000
MAX_DOM_STRING_CHARS = 2 * 1024 * 1024


@dataclass(frozen=True)
class JsonLimits:
    bytes: int
    dicts: int
    items: int
    chars: int


INPUT_LIMITS = JsonLimits(
    MAX_JSON_BYTES, MAX_DOM_DICT_NODES, MAX_DOM_CONTAINER_ITEMS, MAX_DOM_STRING_CHARS
)


def new_budget() -> Dict[str, int]:
    return {
        "json_bytes": 0,
        "pages": 0,
        "dicts": 0,
        "items": 0,
        "chars": 0,
        "tokens": 0,
    }


def parse_json(
    raw_bytes: Union[bytes, bytearray],
    member_name: str,
    dom_budget: Optional[Dict[str, int]] = None,
    *,
    limits: JsonLimits = INPUT_LIMITS,
) -> Any:
    """Parse bounded JSON and count every container and string, including root lists."""
    budget = dom_budget if dom_budget is not None else new_budget()
    budget["json_bytes"] += len(raw_bytes)
    if budget["json_bytes"] > limits.bytes:
        raise RuntimeError(
            f"JSON total size ({budget['json_bytes']}) exceeds limit ({limits.bytes})"
        )
    struct_tokens = (
        raw_bytes.count(b"{") + raw_bytes.count(b"[") + raw_bytes.count(b",")
    )
    budget["tokens"] += struct_tokens
    if budget["tokens"] > limits.items:
        raise RuntimeError(
            f"JSON structural complexity ({budget['tokens']}) exceeds DOM item budget ({limits.items}) in '{member_name}'"
        )

    def _obj_hook(obj: Dict[str, Any]) -> Dict[str, Any]:
        budget["dicts"] += 1
        if budget["dicts"] > limits.dicts:
            raise RuntimeError(
                f"JSON DOM object count ({budget['dicts']}) exceeds limit ({limits.dicts}) in '{member_name}'"
            )
        return obj

    parsed = json.loads(raw_bytes.decode("utf-8"), object_hook=_obj_hook)
    pending = [parsed]
    while pending:
        value = pending.pop()
        if isinstance(value, dict):
            budget["items"] += len(value)
            budget["chars"] += sum(len(key) for key in value)
        elif isinstance(value, list):
            budget["items"] += len(value)
        elif isinstance(value, str):
            budget["chars"] += len(value)
        if budget["items"] > limits.items:
            raise RuntimeError(
                f"JSON DOM container item count ({budget['items']}) exceeds limit ({limits.items}) in '{member_name}'"
            )
        if budget["chars"] > limits.chars:
            raise RuntimeError(
                f"JSON DOM string character count ({budget['chars']}) exceeds limit ({limits.chars}) in '{member_name}'"
            )
        if isinstance(value, dict):
            pending.extend(value.values())
        elif isinstance(value, list):
            pending.extend(value)

    return parsed


def read_json(
    stream: BinaryIO, source_name: str, max_bytes: int = MAX_JSON_BYTES
) -> Any:
    """Bound file and stdin bytes before UTF-8 decoding or JSON parsing."""
    raw = bytearray()
    while True:
        chunk = stream.read(min(65536, max_bytes - len(raw) + 1))
        if not chunk:
            break
        if len(raw) + len(chunk) > max_bytes:
            raise RuntimeError(
                f"JSON input '{source_name}' exceeds byte limit ({max_bytes})"
            )
        raw.extend(chunk)
    return parse_json(raw, source_name)
