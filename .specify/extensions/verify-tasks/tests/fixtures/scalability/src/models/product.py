# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""Product model — T002, T004, T005."""
from dataclasses import dataclass, asdict


@dataclass
class Product:
    id: str
    name: str
    price: float
    stock: int

    def to_dict(self):
        return asdict(self)
