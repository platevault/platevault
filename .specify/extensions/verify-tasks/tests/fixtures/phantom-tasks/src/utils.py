# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""
Utility helpers.
PHANTOM T008: parse_request_body is absent. Only unrelated utilities are present.
"""


def format_date(dt):
    """Format a datetime object to ISO string."""
    return dt.isoformat()


def slugify(text: str) -> str:
    """Convert text to URL-safe slug."""
    return text.lower().replace(" ", "-")
