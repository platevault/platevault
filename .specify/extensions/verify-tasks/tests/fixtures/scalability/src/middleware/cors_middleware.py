# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""CORS middleware — T023."""


class CorsMiddleware:
    def __call__(self, request, next_handler):
        response = next_handler(request)
        if isinstance(response, dict):
            headers = response.setdefault("headers", {})
            headers["Access-Control-Allow-Origin"] = "*"
        return response
