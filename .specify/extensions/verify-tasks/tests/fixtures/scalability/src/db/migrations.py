# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""Database migrations runner — T032."""
from db.connection import DBConnection


def run_migrations(conn: DBConnection) -> None:
    """Apply all pending migrations via conn."""
    conn.execute("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT)")
    conn.execute("CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT, price REAL, stock INTEGER)")
    conn.execute("CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id TEXT)")
