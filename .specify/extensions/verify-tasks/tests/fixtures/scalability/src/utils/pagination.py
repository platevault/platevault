# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""Pagination utility — T036, T040."""
from typing import List


def paginate(items: List, page: int, page_size: int) -> List:
    """Return the slice of items for the given page (1-indexed)."""
    start = (page - 1) * page_size
    return items[start: start + page_size]
