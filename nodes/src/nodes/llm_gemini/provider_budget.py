# Copyright (c) 2026 Aparavi Software AG
"""Optional per-node, per-task Gemini provider attempt limit."""

from threading import Lock


class ProviderAttemptLimitExceeded(RuntimeError):
    """No provider call was made because this node's budget is exhausted."""


class BoundedProviderRequestFailed(RuntimeError):
    """Provider failed; omit its potentially sensitive exception text."""


def bounded_attempts(config):
    """Only the explicitly supported one-attempt mode is accepted."""
    value = config.get('maxProviderAttempts', None)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value != 1:
        raise ValueError('maxProviderAttempts must be 1 when configured')
    return value


class ProviderAttemptBudget:
    """Reserve before the network call; failures and overlapping calls consume attempts."""

    def __init__(self, limit):
        self.limit = limit
        self._used = 0
        self._lock = Lock()

    def reserve(self):
        with self._lock:
            if self._used >= self.limit:
                raise ProviderAttemptLimitExceeded('Gemini provider attempt limit reached')
            self._used += 1
