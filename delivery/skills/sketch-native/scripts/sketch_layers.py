"""Container identity in Sketch archive layers."""

from typing import Any, Dict, Optional


def is_artboard(
    node: Dict[str, Any], parent: Optional[Dict[str, Any]] = None
) -> bool:
    """Recognize legacy artboards and page-level Frame/Graphic containers.

    Sketch's GroupBehavior values are Default=0, Frame=1, Graphic=2. Nested
    Frames remain groups in their enclosing artboard's coordinate system.
    """
    return node.get("_class") == "artboard" or (
        node.get("_class") == "group"
        and type(node.get("groupBehavior")) is int
        and node["groupBehavior"] in (1, 2)
        and (parent or {}).get("_class") == "page"
    )
