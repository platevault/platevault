# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""
Logging middleware.
PHANTOM T009: LoggingMiddleware class exists but __call__ method is missing — behavioral gap.
"""


class LoggingMiddleware:
    """Logs incoming requests. INCOMPLETE — __call__ not implemented."""

    def __init__(self, app):
        self.app = app
