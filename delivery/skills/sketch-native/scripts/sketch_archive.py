"""JSON resource policy for whole Sketch archives, separate from CLI inputs."""

from typing import Any, Dict, Optional, Union

from sketch_json import JsonLimits, parse_json


# Archives retain document/page DOMs for cross-page references. Bound both their
# encoded storage and decoded complexity; image, ZIP, and derived-work limits
# remain independent. These are admission limits, not a process RSS guarantee.
MAX_ZIP_JSON_MEMBER_BYTES = 32 * 1024 * 1024
MAX_ZIP_TOTAL_JSON_BYTES = 128 * 1024 * 1024
JSON_LIMITS = JsonLimits(
    bytes=MAX_ZIP_TOTAL_JSON_BYTES,
    dicts=1000000,
    items=8000000,
    chars=64 * 1024 * 1024,
)


def parse_archive_json(
    raw_bytes: Union[bytes, bytearray],
    member_name: str,
    dom_budget: Optional[Dict[str, int]] = None,
) -> Any:
    """Charge all retained members to one caller-owned archive budget."""
    if len(raw_bytes) > MAX_ZIP_JSON_MEMBER_BYTES:
        raise RuntimeError(
            f"JSON member '{member_name}' exceeds byte limit ({MAX_ZIP_JSON_MEMBER_BYTES})"
        )
    return parse_json(raw_bytes, member_name, dom_budget, limits=JSON_LIMITS)
