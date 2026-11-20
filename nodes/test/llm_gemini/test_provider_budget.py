# Copyright (c) 2026 Aparavi Software AG
"""Mocked transport tests; no provider requests are made."""

from concurrent.futures import ThreadPoolExecutor
import importlib
import threading
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import test_gemini_token_metrics as metrics_test

node = metrics_test._node
budget = importlib.import_module('_llm_gemini_test_package.provider_budget')
global_node = importlib.import_module('_llm_gemini_test_package.IGlobal')


def make_chat(transport, limit=1):
    chat = node.Chat.__new__(node.Chat)
    chat._attempt_budget = budget.ProviderAttemptBudget(limit)
    chat._client = SimpleNamespace(models=SimpleNamespace(generate_content=transport))
    chat._model = 'mock-model'
    return chat


def test_one_attempt_is_reserved_even_on_provider_error():
    transport = Mock(side_effect=ConnectionError('offline'))
    chat = make_chat(transport)
    with pytest.raises(budget.BoundedProviderRequestFailed, match='Gemini provider request failed'):
        chat._chat('sanitized')
    assert chat.is_retryable_error(ConnectionError('offline')) is False
    with pytest.raises(budget.ProviderAttemptLimitExceeded):
        chat._chat('sanitized')
    assert transport.call_count == 1


def test_provider_wrapper_does_not_retry_transport_in_bounded_mode():
    transport = Mock(side_effect=ConnectionError('offline'))
    chat = make_chat(transport)
    with pytest.raises(Exception):
        chat._chat_with_retries('sanitized')
    assert transport.call_count == 1


def test_unbounded_mode_keeps_existing_behavior():
    transport = Mock(return_value=SimpleNamespace(text='ok', usage_metadata=None))
    chat = make_chat(transport)
    chat._attempt_budget = None
    assert chat._chat('one') == 'ok'
    assert chat._chat('two') == 'ok'
    assert transport.call_count == 2


def test_concurrent_requests_share_one_task_budget():
    started = threading.Event()
    release = threading.Event()

    def generate_content(**_):
        started.set()
        release.wait(5)
        return SimpleNamespace(text='ok', usage_metadata=None)

    transport = Mock(side_effect=generate_content)
    chat = make_chat(transport)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(chat._chat, 'one')
        assert started.wait(5)
        second = pool.submit(chat._chat, 'two')
        try:
            with pytest.raises(budget.ProviderAttemptLimitExceeded):
                second.result(timeout=5)
        finally:
            release.set()
        assert first.result(timeout=5) == 'ok'
    assert transport.call_count == 1


def test_bounded_mode_disables_sdk_retries(monkeypatch):
    calls = []
    monkeypatch.setattr(node.Chat.__bases__[0], '__init__', lambda *args: None)
    monkeypatch.setattr(node.Config, 'getNodeConfig', lambda *args: {'apikey': 'fake', 'maxProviderAttempts': 1})
    monkeypatch.setattr(node.genai, 'Client', lambda **kwargs: calls.append(kwargs) or object())
    node.Chat('llm_gemini', {}, {})
    assert calls[0]['http_options'] == {'retry_options': {'attempts': 1}}


def test_bounded_validation_never_issues_a_probe(monkeypatch):
    monkeypatch.setattr(global_node.Config, 'getNodeConfig', lambda *args: {'apikey': 'fake', 'maxProviderAttempts': 1})
    probe = Mock(side_effect=AssertionError('validation must not create a provider client'))
    monkeypatch.setitem(sys.modules, 'google', SimpleNamespace(genai=SimpleNamespace(Client=probe)))
    fake = SimpleNamespace(glb=SimpleNamespace(logicalType='llm_gemini', connConfig={}))
    assert global_node.IGlobal.validateConfig(fake) is None
    probe.assert_not_called()


@pytest.mark.parametrize('invalid', [0, 2, -1, True, '1'])
def test_invalid_budget_fails_closed_without_a_probe(monkeypatch, invalid):
    monkeypatch.setattr(
        global_node.Config, 'getNodeConfig', lambda *args: {'apikey': 'fake', 'maxProviderAttempts': invalid}
    )
    fake = SimpleNamespace(glb=SimpleNamespace(logicalType='llm_gemini', connConfig={}))
    with pytest.raises(ValueError):
        global_node.IGlobal.validateConfig(fake)
