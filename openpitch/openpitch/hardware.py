"""Hardware infrastructure manifest — the verified UniFi (ui.com) stack.

Single source of truth for the three-package deployment model from the v4
reference architecture (see docs/TECHNICAL_ARCHITECTURE_v4.md). Encoded as data
so the backend can validate site packages, the site/device onboarding can
suggest the right devices, and the marketing /hardware page can render it.
"""

from __future__ import annotations

# Capture-layer devices per package: model code -> (display name, qty, role).
PACKAGES: dict[str, dict] = {
    "starter": {
        "name": "Starter",
        "pitch": "5-a-side",
        "capture": [
            {"name": "Camera AI Pro 4K", "model": "UVC-AI-Pro", "qty": 1,
             "role": "Tactical wide-angle; primary analysis feed"},
            {"name": "Camera G5 PTZ", "model": "UVC-G5-PTZ", "qty": 1,
             "role": "Auto-tracking; player close-ups"},
            {"name": "Camera G5 Bullet", "model": "UVC-G5-Bullet", "qty": 1,
             "role": "Endline"},
            {"name": "Outdoor AP", "model": "U7-Outdoor / Pro-Outdoor", "qty": 1,
             "role": "Pitch-side WiFi"},
        ],
    },
    "growth": {
        "name": "Growth",
        "pitch": "7-a-side",
        "capture": [
            {"name": "Camera AI Pro 4K", "model": "UVC-AI-Pro", "qty": 1,
             "role": "Tactical wide-angle; primary analysis feed"},
            {"name": "Camera G5 PTZ", "model": "UVC-G5-PTZ", "qty": 1,
             "role": "Auto-tracking; player close-ups"},
            {"name": "Camera G5 Pro 4K", "model": "UVC-G5-Pro", "qty": 1,
             "role": "Sideline multi-angle"},
            {"name": "Camera G5 Bullet", "model": "UVC-G5-Bullet", "qty": 1,
             "role": "Endline"},
            {"name": "Outdoor AP", "model": "U7-Outdoor / Pro-Outdoor", "qty": 1,
             "role": "Pitch-side WiFi"},
            {"name": "Indoor AP", "model": "U7-Pro", "qty": 1,
             "role": "Clubhouse WiFi"},
        ],
    },
    "pro": {
        "name": "Pro",
        "pitch": "11-a-side",
        "capture": [
            {"name": "Camera AI Pro 4K", "model": "UVC-AI-Pro", "qty": 1,
             "role": "Tactical wide-angle; primary analysis feed"},
            {"name": "Camera G5 PTZ", "model": "UVC-G5-PTZ", "qty": 1,
             "role": "Auto-tracking; player close-ups"},
            {"name": "Camera G5 Pro 4K", "model": "UVC-G5-Pro", "qty": 2,
             "role": "Sideline multi-angle (A/B)"},
            {"name": "Camera G5 Bullet", "model": "UVC-G5-Bullet", "qty": 1,
             "role": "Endline"},
            {"name": "Outdoor AP", "model": "U7-Outdoor / Pro-Outdoor", "qty": 2,
             "role": "Pitch-side WiFi"},
            {"name": "Indoor AP", "model": "U7-Pro", "qty": 1,
             "role": "Clubhouse WiFi"},
        ],
    },
}

# Edge-layer rack (shared across packages; NVR/UPS scale with tier).
EDGE = [
    {"device": "UniFi Gateway", "model": "UDM-Pro / UDM-Pro-Max",
     "role": "Routing, firewall/IDS, VPN, device mgmt, hosts Protect, secure cloud uplink"},
    {"device": "PoE Switch", "model": "USW-24-PoE / USW-Pro-Max-24",
     "role": "Powers + connects cameras and APs; VLAN segmentation"},
    {"device": "UniFi NVR", "model": "UNVR / UNVR-Pro",
     "role": "Local-first recording + RAID (Pro); 30-60 day retention"},
    {"device": "AI Key", "model": "UniFi AI Key",
     "role": "Edge inference: first-pass detection (people/ball/events) ~1,800 events/hr"},
    {"device": "Smart UPS", "model": "UniFi Smart Power",
     "role": "Powers gateway + NVR through outages; graceful NVR shutdown"},
]

# Network segmentation on the gateway.
VLANS = [
    {"vlan": 10, "name": "Cameras", "note": "Isolated; reach NVR + sync only"},
    {"vlan": 20, "name": "Management", "note": "NVR, AI Key, gateway"},
    {"vlan": 30, "name": "Coach/Staff WiFi", "note": "Staff devices"},
    {"vlan": 40, "name": "Guest/Parent WiFi", "note": "Fully segregated"},
]

# Device kinds an installer pairs to a site (used by the device registry).
DEVICE_KINDS = [
    "gateway", "nvr", "ai-key", "switch",
    "camera-ai-pro", "camera-g5-ptz", "camera-g5-pro", "camera-g5-bullet",
    "ap-outdoor", "ap-indoor",
]


def manifest() -> dict:
    """Serializable infrastructure manifest for the API / marketing site."""
    return {
        "packages": [
            {"id": pid, **{k: v for k, v in p.items()},
             "camera_count": sum(c["qty"] for c in p["capture"] if "Camera" in c["name"])}
            for pid, p in PACKAGES.items()
        ],
        "edge": EDGE,
        "vlans": VLANS,
        "device_kinds": DEVICE_KINDS,
    }
