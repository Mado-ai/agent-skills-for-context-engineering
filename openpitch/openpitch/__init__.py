"""OpenPitch — open-source AI soccer capture, auto-production and analytics.

An end-to-end prototype mirroring the two halves of platforms like
Pixellot (automated capture / virtual-cameraman broadcast production) and
BePro (computer-vision tracking and performance analytics).

Pipeline stages:
    ingest -> detect -> track -> virtual_camera -> overlay -> (broadcast)
                                \-> analytics + highlights

The default detector uses colour segmentation so the whole system runs on
CPU with no model download. Set ``OPENPITCH_DETECTOR=yolo`` to use a real
YOLO model instead (requires ``ultralytics``).
"""

__version__ = "0.1.0"
