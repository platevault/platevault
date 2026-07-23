# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""
Application configuration.
Genuine implementation — T004.
"""
from dataclasses import dataclass


@dataclass
class AppConfig:
    """Holds application configuration values."""
    host: str = "0.0.0.0"
    port: int = 8080
    debug: bool = False
