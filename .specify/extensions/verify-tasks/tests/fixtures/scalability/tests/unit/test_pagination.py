# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""Unit tests for paginate — T044."""
from utils.pagination import paginate


def test_paginate_first_page():
    items = list(range(10))
    assert paginate(items, 1, 3) == [0, 1, 2]


def test_paginate_last_page():
    items = list(range(10))
    assert paginate(items, 4, 3) == [9]


def test_paginate_empty():
    assert paginate([], 1, 5) == []
