"""Shared Sketch text-style interpretation for measurement and font auditing."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


def encoded_attributes(style_container: Dict[str, Any]) -> Dict[str, Any]:
    """Extract encodedAttributes dict from a sharedStyle, style, or textStyle dict."""
    if not isinstance(style_container, dict):
        return {}
    val = style_container.get("value")
    if isinstance(val, dict):
        ts = val.get("textStyle")
        if isinstance(ts, dict) and isinstance(ts.get("encodedAttributes"), dict):
            return ts["encodedAttributes"]
        if isinstance(val.get("encodedAttributes"), dict):
            return val["encodedAttributes"]
        attr_str = val.get("attributedString")
        if isinstance(attr_str, dict) and isinstance(attr_str.get("attributes"), list) and attr_str["attributes"]:
            first = attr_str["attributes"][0]
            if isinstance(first, dict) and isinstance(first.get("attributes"), dict):
                return first["attributes"]
    ts = style_container.get("textStyle")
    if isinstance(ts, dict) and isinstance(ts.get("encodedAttributes"), dict):
        return ts["encodedAttributes"]
    if isinstance(style_container.get("encodedAttributes"), dict):
        return style_container["encodedAttributes"]
    return {}


def index_shared_text_styles(
    doc_data: Optional[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    styles: Dict[str, Dict[str, Any]] = {}
    if not isinstance(doc_data, dict):
        return styles
    for obj in (doc_data.get("layerTextStyles") or {}).get("objects") or []:
        if isinstance(obj, dict) and obj.get("do_objectID"):
            styles[str(obj["do_objectID"])] = encoded_attributes(obj)
    for fts in doc_data.get("foreignTextStyles") or []:
        if not isinstance(fts, dict):
            continue
        local_ss = fts.get("localSharedStyle")
        if isinstance(local_ss, dict) and local_ss.get("do_objectID"):
            styles[str(local_ss["do_objectID"])] = encoded_attributes(local_ss)
        if fts.get("do_objectID") and str(fts["do_objectID"]) not in styles:
            styles[str(fts["do_objectID"])] = encoded_attributes(
                local_ss if isinstance(local_ss, dict) else fts
            )
    return styles


def font_attributes(descriptor: Any) -> Dict[str, Any]:
    if not isinstance(descriptor, dict):
        return {}
    attributes = descriptor.get("attributes")
    return dict(attributes if isinstance(attributes, dict) else descriptor)


def font_and_paragraph(
    attr_dict: Dict[str, Any],
) -> Tuple[Dict[str, Any], Dict[str, Any], Optional[float]]:
    if not isinstance(attr_dict, dict):
        return {}, {}, None
    raw_font = (
        attr_dict.get("MSAttributedStringFontAttribute")
        or attr_dict.get("fontDescriptor")
        or {}
    )
    f_desc = font_attributes(raw_font)
    p_style = (
        dict(attr_dict["paragraphStyle"])
        if isinstance(attr_dict.get("paragraphStyle"), dict)
        else {}
    )
    kern = (
        float(attr_dict["kerning"])
        if attr_dict.get("kerning") is not None
        else None
    )
    return f_desc, p_style, kern


def resolve_text_style(
    layer: Dict[str, Any],
    shared_text_styles: Optional[Dict[str, Dict[str, Any]]] = None,
    override_style_id: Optional[str] = None,
    include_runs: bool = True,
) -> Dict[str, Any]:
    attr_str = layer.get("attributedString") or {}
    attrs_list = attr_str.get("attributes") or []
    first_attr = (attrs_list[0].get("attributes") if attrs_list else {}) or {}

    style_encoded = encoded_attributes(layer.get("style") or {})
    shared_sid = str(layer.get("sharedStyleID", "") or "")
    shared_encoded = (
        (shared_text_styles or {}).get(shared_sid, {}) if shared_sid else {}
    )
    override_encoded = (
        (shared_text_styles or {}).get(str(override_style_id), {})
        if override_style_id
        else {}
    )

    font_desc: Dict[str, Any] = {}
    para_style: Dict[str, Any] = {}
    kerning_val: float = 0.0
    # Priority: sharedStyle default -> inline layer.style -> attributedString[0] -> override_style_id
    for candidate_attrs in (shared_encoded, style_encoded, first_attr, override_encoded):
        if not candidate_attrs:
            continue
        fd, ps, kn = font_and_paragraph(candidate_attrs)
        if fd:
            if fd.get("name") and not fd.get("NSCTFontUIUsageAttribute"):
                font_desc.pop("NSCTFontUIUsageAttribute", None)
            elif fd.get("NSCTFontUIUsageAttribute") and not fd.get("name"):
                font_desc.pop("name", None)
            font_desc.update({k: v for k, v in fd.items() if v is not None})
        if ps:
            para_style.update({k: v for k, v in ps.items() if v is not None})
        if kn is not None:
            kerning_val = kn

    font_name = font_desc.get("name")
    ui_usage = font_desc.get("NSCTFontUIUsageAttribute")
    font_size = float(font_desc.get("size", 14.0))
    line_height = para_style.get("maximumLineHeight") or para_style.get(
        "minimumLineHeight"
    )
    para_spacing = float(para_style.get("paragraphSpacing", 0.0) or 0.0)
    kerning = kerning_val

    runs: List[Dict[str, Any]] = []
    if include_runs and not override_encoded:
        for attr_entry in attrs_list:
            if not isinstance(attr_entry, dict):
                continue
            loc = int(attr_entry.get("location", 0) or 0)
            length = int(attr_entry.get("length", 0) or 0)
            if length <= 0:
                continue
            sub_attrs = attr_entry.get("attributes") or {}
            sub_font, sub_para, sub_kern = font_and_paragraph(sub_attrs)
            sub_lh = sub_para.get("maximumLineHeight") or sub_para.get(
                "minimumLineHeight"
            )
            sub_has_name = bool(sub_font.get("name"))
            sub_has_usage = bool(sub_font.get("NSCTFontUIUsageAttribute"))
            if sub_has_name or sub_has_usage:
                run_font_name = sub_font.get("name")
                run_ui_usage = sub_font.get("NSCTFontUIUsageAttribute")
            else:
                run_font_name = font_name
                run_ui_usage = ui_usage
            runs.append(
                {
                    "location": loc,
                    "length": length,
                    "fontName": run_font_name,
                    "uiUsage": run_ui_usage,
                    "fontSize": float(sub_font.get("size", font_size)),
                    "lineHeight": (
                        float(sub_lh)
                        if sub_lh is not None
                        else (float(line_height) if line_height is not None else None)
                    ),
                    "paragraphSpacing": float(
                        sub_para.get("paragraphSpacing", para_spacing) or 0.0
                    ),
                    "kerning": float(sub_kern if sub_kern is not None else kerning),
                }
            )

    spec_out: Dict[str, Any] = {
        "fontName": font_name,
        "uiUsage": ui_usage,
        "fontSize": font_size,
        "lineHeight": float(line_height) if line_height is not None else None,
        "paragraphSpacing": para_spacing,
        "kerning": kerning,
    }
    if runs:
        spec_out["runs"] = runs
    return spec_out
