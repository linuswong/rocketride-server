"""Offline Jira Cloud connector tests; no credentials or network are used."""

import importlib.util
import json
import sys
import types
import unittest
import uuid
from pathlib import Path
from unittest.mock import Mock, patch

import requests

PATH = Path(__file__).resolve().parents[2] / 'src' / 'nodes' / 'tool_jira_service_management' / 'jira_client.py'
spec = importlib.util.spec_from_file_location('jira_client_test', PATH)
jira = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jira)
CONFIG = {'domain': 'example.atlassian.net', 'email': 'operator@example.com', 'apiToken': 'fixture-token'}
OAUTH = {
    'authMode': 'oauth',
    'domain': 'example.atlassian.net',
    'cloudId': '11223344-a1b2-3b33-c444-def123456789',
    'accessToken': 'fixture-oauth-token',
}
RESOURCE = {
    'id': OAUTH['cloudId'],
    'url': 'https://example.atlassian.net',
    'scopes': ['read:servicedesk-request'],
}
case = unittest.TestCase()


class Response:
    def __init__(self, data, status=200, headers=None):
        self.status_code = status
        self.data = json.dumps(data).encode()
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass

    def iter_content(self, chunk_size):
        yield self.data


def test_rejects_untrusted_or_malformed_hosts():
    for host in (
        'https://example.atlassian.net',
        'example.atlassian.net.evil.org',
        'localhost',
        'example.atlassian.net:443',
        'Example.atlassian.net',
        'example.atlassian.net/other',
    ):
        with case.assertRaises(ValueError):
            jira.validate_config({**CONFIG, 'domain': host})


def test_rejects_unresolved_or_malformed_credentials():
    for field, value in (
        ('apiToken', '${ROCKETRIDE_JIRA_API_TOKEN}'),
        ('apiToken', 'with spaces'),
        ('email', ''),
        ('email', 'a\nb'),
        ('email', 'name:other@example.com'),
    ):
        with case.assertRaises(ValueError):
            jira.validate_config({**CONFIG, field: value})


def test_oauth_configuration_rejects_invalid_cloud_ids_and_conflicting_credentials():
    for field, value in (
        ('cloudId', '../other'),
        ('cloudId', '11223344-A1B2-3B33-C444-DEF123456789'),
        ('accessToken', '${ROCKETRIDE_JIRA_ACCESS_TOKEN}'),
        ('accessToken', 'token\nsecret'),
        ('apiToken', 'conflicting-secret'),
        ('authMode', 'unsupported'),
    ):
        with case.assertRaises(ValueError):
            jira.validate_config({**OAUTH, field: value})
    with case.assertRaises(ValueError):
        jira.validate_config({**CONFIG, 'accessToken': 'conflicting-secret'})


def test_scoped_api_token_uses_the_atlassian_gateway_and_basic_auth():
    scoped = {
        'authMode': 'scoped_basic',
        'cloudId': OAUTH['cloudId'],
        'email': CONFIG['email'],
        'apiToken': CONFIG['apiToken'],
    }
    client = jira.JiraClient(scoped)
    client._session.get = Mock(return_value=Response({'issueKey': 'SUP-1'}))
    assert client.get_request('SUP-1')['issue_key'] == 'SUP-1'
    url = client._session.get.call_args.args[0]
    assert url == f'https://api.atlassian.com/ex/jira/{OAUTH["cloudId"]}/rest/servicedeskapi/request/SUP-1'
    assert client._session.get.call_args.kwargs['allow_redirects'] is False
    assert client._session.get.call_count == 1
    prepared = client._session.prepare_request(requests.Request('GET', url))
    assert prepared.headers['Authorization'].startswith('Basic ')
    assert 'fixture-token' not in url
    for bad in ('../other', '', OAUTH['cloudId'].upper()):
        with case.assertRaises(ValueError):
            jira.validate_config({**scoped, 'cloudId': bad})


def test_oauth_verifies_site_and_scopes_before_each_fixed_route():
    client = jira.JiraClient(OAUTH)
    client._session.get = Mock(
        side_effect=[
            Response([RESOURCE]),
            Response({'issueKey': 'SUP-1'}),
            Response([RESOURCE]),
            Response({'values': [], 'start': 0, 'limit': 20, 'size': 0, 'isLastPage': True}),
        ]
    )
    assert client.get_request('SUP-1')['issue_key'] == 'SUP-1'
    assert client.list_requests()['last_page'] is True
    calls = client._session.get.call_args_list
    assert [call.args[0] for call in calls] == [
        'https://api.atlassian.com/oauth/token/accessible-resources',
        f'https://api.atlassian.com/ex/jira/{OAUTH["cloudId"]}/rest/servicedeskapi/request/SUP-1',
        'https://api.atlassian.com/oauth/token/accessible-resources',
        f'https://api.atlassian.com/ex/jira/{OAUTH["cloudId"]}/rest/servicedeskapi/request',
    ]
    assert all(call.kwargs['allow_redirects'] is False for call in calls)
    prepared = client._session.prepare_request(requests.Request('GET', calls[0].args[0]))
    assert prepared.headers['Authorization'] == 'Bearer fixture-oauth-token'
    client.close()
    assert client._session.auth is None


def test_oauth_denies_unverified_wrong_or_ambiguous_sites_before_request_read():
    for resources in (
        [],
        [{**RESOURCE, 'id': '00000000-0000-0000-0000-000000000000'}],
        [{**RESOURCE, 'url': 'https://other.atlassian.net'}],
        [{**RESOURCE, 'scopes': ['read:jira-user']}],
        [RESOURCE, RESOURCE],
        {'id': OAUTH['cloudId']},
    ):
        client = jira.JiraClient(OAUTH)
        client._session.get = Mock(return_value=Response(resources))
        with case.assertRaises(jira.JiraError):
            client.get_request('SUP-1')
        assert client._session.get.call_count == 1


def test_oauth_accepts_granular_scopes_and_sanitizes_failures():
    client = jira.JiraClient(OAUTH)
    granular = {**RESOURCE, 'scopes': ['read:request:jira-service-management', 'read:user:jira']}
    client._session.get = Mock(side_effect=[Response([granular]), Response({'issueKey': 'SUP-1'})])
    assert client.get_request('SUP-1')['issue_key'] == 'SUP-1'
    for response in (Response({'error': 'secret'}, 401), Response({'secret': 'fixture-oauth-token'}, 302)):
        client._session.get = Mock(return_value=response)
        with case.assertRaises(jira.JiraError) as error:
            client.get_request('SUP-1')
        assert 'secret' not in str(error.exception)
        assert client._session.get.call_count == 1


def test_oauth_disambiguates_containers_with_shared_cloud_id_by_site_and_jira_scopes():
    client = jira.JiraClient(OAUTH)
    confluence = {**RESOURCE, 'scopes': ['read:confluence-content.all']}
    other_site = {**RESOURCE, 'url': 'https://other.atlassian.net'}
    client._session.get = Mock(
        side_effect=[Response([confluence, other_site, RESOURCE]), Response({'issueKey': 'SUP-1'})]
    )
    assert client.get_request('SUP-1')['issue_key'] == 'SUP-1'
    assert client._session.get.call_count == 2
    # Two Jira-qualified entries for the configured site remain ambiguous.
    client._session.get = Mock(return_value=Response([confluence, RESOURCE, RESOURCE]))
    with case.assertRaises(jira.JiraError) as error:
        client.get_request('SUP-1')
    assert error.exception.code == 'RESOURCE_ACCESS'
    client._session.get.assert_called_once()
    client.close()


def test_configuration_module_loads_before_optional_dependency_installation():
    with patch.dict(sys.modules, {'requests': None}):
        module_spec = importlib.util.spec_from_file_location('jira_config_without_requests', PATH)
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        module.validate_config(CONFIG)


def test_get_request_uses_fixed_host_and_returns_allowlisted_fields():
    client = jira.JiraClient(CONFIG)
    client._session.get = Mock(
        return_value=Response(
            {
                'issueKey': 'HELP-42',
                'currentStatus': {'status': 'Open'},
                'createdDate': {'iso8601': '2026-01-01T00:00:00Z'},
                'reporter': {'emailAddress': 'private@example.com'},
                'requestFieldValues': [{'value': 'private ticket'}],
            }
        )
    )
    result = client.get_request('HELP-42')
    assert result['status'] == 'Open'
    assert 'private' not in json.dumps(result)
    args, kwargs = client._session.get.call_args
    assert args[0] == 'https://example.atlassian.net/rest/servicedeskapi/request/HELP-42'
    assert kwargs['allow_redirects'] is False
    assert kwargs['timeout'] == (5, 20)


def test_request_summary_is_opt_in_bounded_and_excludes_other_fields():
    client = jira.JiraClient(CONFIG)
    request = {
        'issueKey': 'HELP-42',
        'reporter': {'emailAddress': 'private@example.com'},
        'requestFieldValues': [
            {'fieldId': 'summary', 'value': 'Cannot sign in'},
            {'fieldId': 'description', 'value': 'private-description'},
            {'fieldId': 'customfield_1', 'value': 'private-custom-field'},
        ],
    }
    client._session.get = Mock(return_value=Response(request))
    assert 'summary' not in client.get_request('HELP-42')
    result = client.get_request('HELP-42', include_summary=True)
    assert result['summary'] == 'Cannot sign in'
    assert 'private' not in json.dumps(result)
    for fields in (
        [{'fieldId': 'summary', 'value': 'a'}, {'fieldId': 'summary', 'value': 'b'}],
        [{'fieldId': 'summary', 'value': 'a' * 256}],
        [{'fieldId': 'summary', 'value': 'line\nbreak'}],
        [{'fieldId': 'summary', 'value': {'text': 'unsafe'}}],
        ['malformed'],
    ):
        client._session.get = Mock(return_value=Response({**request, 'requestFieldValues': fields}))
        with case.assertRaises(jira.JiraError):
            client.get_request('HELP-42', include_summary=True)
    client._session.get = Mock(return_value=Response({'issueKey': 'HELP-42'}))
    assert client.get_request('HELP-42', include_summary=True)['summary'] is None
    client._session.get = Mock(return_value=Response({'issueKey': 'HELP-42', 'summary': 'Top-level title'}))
    assert client.get_request('HELP-42', include_summary=True)['summary'] == 'Top-level title'
    assert 'summary' not in client.get_request('HELP-42')
    client._session.get = Mock(return_value=Response({**request, 'summary': 'Different title'}))
    with case.assertRaisesRegex(jira.JiraError, 'conflicting'):
        client.get_request('HELP-42', include_summary=True)
    client._session.get.reset_mock()
    with case.assertRaises(jira.JiraError):
        client.get_request('HELP-42', include_summary='true')
    client._session.get.assert_not_called()


def test_request_metadata_rejects_controls_and_malformed_values_without_disclosing_them():
    client = jira.JiraClient(CONFIG)
    for extra in (
        {'currentStatus': {'status': 'Open\nprivate'}},
        {'currentStatus': {'status': 'x' * 201}},
        {'currentStatus': 'unexpected'},
        {'createdDate': 'unexpected'},
        {'serviceDeskId': ['unexpected']},
        {'requestTypeId': 'private\rvalue'},
    ):
        client._session.get = Mock(return_value=Response({'issueKey': 'HELP-42', **extra}))
        with case.assertRaises(jira.JiraError) as error:
            client.get_request('HELP-42')
        assert error.exception.code == 'INVALID_RESPONSE'
        assert 'private' not in str(error.exception)
    client.close()


def test_invalid_keys_and_pagination_never_make_a_request():
    client = jira.JiraClient(CONFIG)
    client._session.get = Mock()
    for key in ('../other', 'HELP-1/comment', 'HELP-1?x=1', '', 'HELP-0'):
        with case.assertRaises(jira.JiraError):
            client.get_request(key)
    for args in ((-1, 10), (0, 51), (True, 1)):
        with case.assertRaises(jira.JiraError):
            client.list_requests(*args)
    client._session.get.assert_not_called()


def test_lookup_rejects_an_unrelated_request():
    client = jira.JiraClient(CONFIG)
    client._session.get = Mock(return_value=Response({'issueKey': 'SUP-2', 'issueId': '202'}))
    for key in ('SUP-1', '101'):
        with case.assertRaisesRegex(jira.JiraError, 'different customer request'):
            client.get_request(key)
    assert client.get_request('202')['issue_key'] == 'SUP-2'


def test_list_returns_coverage_and_rejects_invalid_pages():
    client = jira.JiraClient(CONFIG)
    client._session.get = Mock(
        return_value=Response(
            {'values': [{'issueKey': 'SUP-1'}], 'start': 0, 'limit': 2, 'size': 1, 'isLastPage': False}
        )
    )
    page = client.list_requests(0, 2)
    assert (page['start'], page['limit'], page['size'], page['last_page']) == (0, 2, 1, False)
    client._session.get.return_value = Response({'values': [], 'isLastPage': 'false'})
    with case.assertRaisesRegex(jira.JiraError, 'invalid request page'):
        client.list_requests()


def test_list_rejects_unverified_or_conflicting_pagination_and_duplicate_requests():
    client = jira.JiraClient(CONFIG)
    valid = {'values': [{'issueKey': 'SUP-1'}], 'start': 10, 'limit': 2, 'size': 1, 'isLastPage': False}
    client._session.get = Mock(return_value=Response(valid))
    page = client.list_requests(10, 2)
    assert (page['start'], page['limit'], page['size']) == (10, 2, 1)
    for change in (
        {'start': 0},
        {'start': True},
        {'limit': 3},
        {'limit': 0},
        {'size': 0},
        {'size': True},
        {'values': [{'issueKey': 'SUP-1'}, {'issueKey': 'sup-1'}], 'size': 2},
    ):
        client._session.get.return_value = Response({**valid, **change})
        with case.assertRaises(jira.JiraError) as error:
            client.list_requests(10, 2)
        assert error.exception.code == 'INVALID_RESPONSE'
    for missing in ('start', 'size', 'limit'):
        client._session.get.return_value = Response({key: value for key, value in valid.items() if key != missing})
        with case.assertRaises(jira.JiraError):
            client.list_requests(10, 2)
    client.close()


def test_failures_and_redirects_do_not_disclose_provider_responses():
    client = jira.JiraClient(CONFIG)
    for status in (302, 401, 403, 404, 429, 500):
        client._session.get = Mock(return_value=Response({'error': 'private-ticket-and-token'}, status))
        with case.assertRaises(jira.JiraError) as error:
            client.get_request('SUP-1')
        assert 'private' not in str(error.exception)
    client._session.get = Mock(side_effect=requests.ConnectionError('fixture-token'))
    with case.assertRaises(jira.JiraError) as error:
        client.get_request('SUP-1')
    assert error.exception.code == 'UNAVAILABLE'
    assert 'fixture-token' not in str(error.exception)


def test_rate_limits_expose_only_bounded_retry_after_and_never_auto_retry():
    client = jira.JiraClient(CONFIG)
    for status, header, expected in (
        (429, '14', 14),
        (503, '0', 0),
        (429, '-1', None),
        (429, '86401', None),
        (429, 'secret', None),
        (429, '1.5', None),
    ):
        client._session.get = Mock(return_value=Response({'error': 'private'}, status, {'Retry-After': header}))
        with case.assertRaises(jira.JiraError) as error:
            client.get_request('SUP-1')
        assert error.exception.retry_after_seconds == expected
        assert 'private' not in str(error.exception)
        client._session.get.assert_called_once()


def test_response_size_is_bounded():
    client = jira.JiraClient(CONFIG)
    client._session.get = Mock(return_value=Response({'filler': 'a' * (1024 * 1024)}))
    with case.assertRaisesRegex(jira.JiraError, 'size limit'):
        client.get_request('SUP-1')


def test_invalid_or_ambiguous_json_fails_without_leaking_or_crashing():
    client = jira.JiraClient(CONFIG)
    for raw in (
        b'{"issueKey":"SUP-1","issueKey":"SUP-2"}',
        b'{"issueKey":"SUP-1","currentStatus":{"status":"Open","status":"Closed"}}',
        b'{"issueKey":"SUP-1","extra":NaN}',
        b'[' * 2000 + b'0' + b']' * 2000,
    ):
        response = Response({})
        response.data = raw
        client._session.get = Mock(return_value=response)
        with case.assertRaises(jira.JiraError) as error:
            client.get_request('SUP-1')
        assert error.exception.code == 'INVALID_RESPONSE'
        assert 'SUP-2' not in str(error.exception)
    client.close()


def test_close_clears_session_credentials():
    client = jira.JiraClient(CONFIG)
    assert client._session.auth is not None
    client.close()
    assert client._session.auth is None


def test_node_tools_validate_inputs_and_never_publish_writes():
    rocketlib = types.ModuleType('rocketlib')
    rocketlib.IInstanceBase = type('IInstanceBase', (), {})

    def decorator(**metadata):
        def decorate(function):
            function.__tool_meta__ = metadata
            return function

        return decorate

    rocketlib.tool_function = decorator
    ai = types.ModuleType('ai')
    common = types.ModuleType('ai.common')
    utils = types.ModuleType('ai.common.utils')
    utils.normalize_tool_input = lambda value, **_kwargs: value.get('input', value)
    package = types.ModuleType('jira_fixture')
    package.__path__ = [str(PATH.parent)]
    modules = {
        'rocketlib': rocketlib,
        'ai': ai,
        'ai.common': common,
        'ai.common.utils': utils,
        'jira_fixture': package,
        'jira_fixture.jira_client': jira,
    }
    with patch.dict(sys.modules, modules):
        module_spec = importlib.util.spec_from_file_location('jira_fixture.IInstance', PATH.parent / 'IInstance.py')
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        instance = module.IInstance()
        instance.IGlobal = types.SimpleNamespace(client=Mock())
        assert {
            name for name in dir(module.IInstance) if hasattr(getattr(module.IInstance, name), '__tool_meta__')
        } == {'get_request', 'list_requests'}
        for name in ('get_request', 'list_requests'):
            metadata = getattr(module.IInstance, name).__tool_meta__
            assert metadata['input_schema']['additionalProperties'] is False
            assert metadata['output_schema']['required'] == ['success']
        for bad in (None, [], '{bad', {'input': 'bad'}, {'unknown': 1}):
            assert instance.list_requests(bad)['success'] is False
        instance.IGlobal.client.list_requests.assert_not_called()
        instance.IGlobal.client.get_request.return_value = {'issue_key': 'SUP-1'}
        assert instance.get_request({'issue_key': 'SUP-1'})['request']['issue_key'] == 'SUP-1'
        assert instance.get_request({'issue_key': 'SUP-1', 'include_summary': 'true'})['success'] is False
        instance.IGlobal.client.get_request.assert_called_once_with('SUP-1', False)
        instance.IGlobal.client.get_request.reset_mock()
        assert instance.get_request({'issue_key': 'SUP-1', 'include_summary': True})['success'] is True
        instance.IGlobal.client.get_request.assert_called_once_with('SUP-1', True)
        instance.IGlobal.client.get_request.side_effect = jira.JiraError(
            'RATE_LIMITED', 'Retry later.', retry_after_seconds=9
        )
        assert instance.get_request({'issue_key': 'SUP-1'}) == {
            'success': False,
            'error_code': 'RATE_LIMITED',
            'error': 'Retry later.',
            'retryable': True,
            'retry_after_seconds': 9,
        }
        instance.IGlobal.client = None
        assert instance.get_request({'issue_key': 'SUP-1'})['error_code'] == 'CLIENT_CLOSED'


def test_catalog_registers_experimental_read_only_cloud_tool_and_secret():
    service = json.loads((PATH.parent / 'services.json').read_text(encoding='utf-8'))
    assert service['protocol'] == 'tool_jira_service_management://'
    assert service['path'] == 'nodes.tool_jira_service_management'
    assert 'experimental' in service['capabilities']
    token = service['fields']['jira_service_management.apiToken']
    assert token['secure'] is True
    assert token['pattern'] == r'^(?:|\$\{ROCKETRIDE_[A-Z0-9_]+\})$'
    oauth_token = service['fields']['jira_service_management.accessToken']
    assert oauth_token['secure'] is True
    assert oauth_token['pattern'] == token['pattern']


def test_example_pipeline_exposes_only_the_jira_tool_and_environment_references():
    pipeline = json.loads((PATH.parent / 'example.pipe').read_text(encoding='utf-8'))
    uuid.UUID(pipeline['project_id'])
    components = {component['id']: component for component in pipeline['components']}
    assert {component['provider'] for component in components.values()} == {'tools', 'tool_jira_service_management'}
    node = components['tool_jira_service_management_1']
    assert node['control'] == [{'classType': 'tool', 'from': 'tools_1'}]
    assert node['config']['authMode'] == 'oauth'
    assert node['config']['domain'] == '${ROCKETRIDE_JIRA_DOMAIN}'
    assert node['config']['cloudId'] == '${ROCKETRIDE_JIRA_CLOUD_ID}'
    assert node['config']['accessToken'] == '${ROCKETRIDE_JIRA_ACCESS_TOKEN}'
    assert node['config']['apiToken'] == ''


def test_global_lifecycle_initializes_and_releases_the_client():
    rocketlib = types.ModuleType('rocketlib')
    rocketlib.IGlobalBase = type('IGlobalBase', (), {})
    rocketlib.OPEN_MODE = types.SimpleNamespace(CONFIG='config')
    rocketlib.warning = Mock()
    config = types.ModuleType('ai.common.config')
    config.Config = types.SimpleNamespace(getNodeConfig=Mock(return_value=CONFIG))
    depends = types.ModuleType('depends')
    depends.depends = Mock()
    package = types.ModuleType('jira_lifecycle_fixture')
    package.__path__ = [str(PATH.parent)]
    modules = {
        'rocketlib': rocketlib,
        'ai': types.ModuleType('ai'),
        'ai.common': types.ModuleType('ai.common'),
        'ai.common.config': config,
        'depends': depends,
        'jira_lifecycle_fixture': package,
        'jira_lifecycle_fixture.jira_client': jira,
    }
    with patch.dict(sys.modules, modules):
        module_spec = importlib.util.spec_from_file_location(
            'jira_lifecycle_fixture.IGlobal', PATH.parent / 'IGlobal.py'
        )
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        instance = module.IGlobal()
        instance.IEndpoint = types.SimpleNamespace(endpoint=types.SimpleNamespace(openMode='execute'))
        instance.glb = types.SimpleNamespace(logicalType='tool_jira_service_management', connConfig={})
        instance.beginGlobal()
        assert isinstance(instance.client, jira.JiraClient)
        depends.depends.assert_called_once()
        instance.endGlobal()
        assert instance.client is None


def test_jira_tools_register_and_dispatch_through_rocketride_tool_protocol():
    root = PATH.parents[4]
    filters_path = root / 'packages/server/engine-lib/rocketlib-python/lib/rocketlib/filters.py'
    helper_path = root / 'packages/ai/src/ai/common/utils/tool_args.py'
    package = types.ModuleType('jira_dispatch_rocketlib')
    package.__path__ = [str(filters_path.parent)]
    fake_types = types.ModuleType(package.__name__ + '.types')
    for name in ('AVI_ACTION', 'OPEN_MODE', 'ENDPOINT_MODE', 'SERVICE_MODE', 'Entry', 'IControl', 'IInvoke', 'IJson'):
        setattr(fake_types, name, type(name, (), {}))
    fake_error = types.ModuleType(package.__name__ + '.error')
    fake_error.APERR = type('APERR', (Exception,), {})
    fake_error.Ec = types.SimpleNamespace(PreventDefault='PreventDefault', InvalidParam='InvalidParam')
    engine = types.ModuleType('engLib')
    engine.IFilterInstance = type('IFilterInstance', (), {})
    modules = {
        'engLib': engine,
        package.__name__: package,
        fake_types.__name__: fake_types,
        fake_error.__name__: fake_error,
    }
    with patch.dict(sys.modules, modules):
        filters_spec = importlib.util.spec_from_file_location(package.__name__ + '.filters', filters_path)
        filters = importlib.util.module_from_spec(filters_spec)
        sys.modules[filters_spec.name] = filters
        filters_spec.loader.exec_module(filters)
        rocketlib = types.ModuleType('rocketlib')
        rocketlib.IInstanceBase = type('IInstanceBase', (), {})
        rocketlib.tool_function = filters.tool_function
        rocketlib.warning = Mock()
        with patch.dict(sys.modules, {'rocketlib': rocketlib}):
            helper_spec = importlib.util.spec_from_file_location('jira_dispatch_tool_args', helper_path)
            helper = importlib.util.module_from_spec(helper_spec)
            helper_spec.loader.exec_module(helper)
            utils = types.ModuleType('ai.common.utils')
            utils.normalize_tool_input = helper.normalize_tool_input
            node_package = types.ModuleType('jira_dispatch_node')
            node_package.__path__ = [str(PATH.parent)]
            fake_modules = {
                'ai': types.ModuleType('ai'),
                'ai.common': types.ModuleType('ai.common'),
                'ai.common.utils': utils,
                node_package.__name__: node_package,
                node_package.__name__ + '.jira_client': jira,
            }
            with patch.dict(sys.modules, fake_modules):
                spec = importlib.util.spec_from_file_location(
                    node_package.__name__ + '.IInstance', PATH.parent / 'IInstance.py'
                )
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)

                class DispatchInstance(module.IInstance, filters.IInstanceBase):
                    pass

                instance = DispatchInstance()
                client = Mock()
                client.get_request.return_value = {'issue_key': 'SUP-1'}
                instance.IGlobal = types.SimpleNamespace(client=client)
                query = {'tools': []}
                with case.assertRaises(fake_error.APERR):
                    instance._dispatch_tool(query, 'tool.query')
                assert {item['name'] for item in query['tools']} == {'get_request', 'list_requests'}
                assert all('outputSchema' in item for item in query['tools'])
                result = instance._dispatch_tool(
                    {'tool_name': 'get_request', 'input': {'input': {'issue_key': 'SUP-1', 'include_summary': True}}},
                    'tool.invoke',
                )
                assert result['output']['request']['issue_key'] == 'SUP-1'
                client.get_request.assert_called_once_with('SUP-1', True)
                client.reset_mock()
                for bad in (
                    None,
                    [],
                    {'input': []},
                    {'issue_key': 'SUP-1', 'unexpected': True},
                    {'issue_key': 'SUP-1', 'include_summary': 'yes'},
                ):
                    response = instance._dispatch_tool({'tool_name': 'get_request', 'input': bad}, 'tool.invoke')
                    assert response['output']['error_code'] == 'INVALID_INPUT'
                client.get_request.assert_not_called()
                wire_client = jira.JiraClient(OAUTH)
                wire_client._session.get = Mock(
                    side_effect=[
                        Response([RESOURCE]),
                        Response(
                            {
                                'issueKey': 'SUP-1',
                                'requestFieldValues': [
                                    {'fieldId': 'summary', 'value': 'Cannot sign in'},
                                    {'fieldId': 'description', 'value': 'private-description'},
                                ],
                            }
                        ),
                    ]
                )
                instance.IGlobal.client = wire_client
                result = instance._dispatch_tool(
                    {'tool_name': 'get_request', 'input': {'issue_key': 'SUP-1', 'include_summary': True}},
                    'tool.invoke',
                )
                assert result['output']['request']['summary'] == 'Cannot sign in'
                assert 'private-description' not in json.dumps(result['output'])
                assert wire_client._session.get.call_count == 2
                wire_client.close()


def test_response_read_time_is_bounded_without_leaking_response():
    client = jira.JiraClient(CONFIG)
    client._session.get = Mock(return_value=Response({'private': 'secret'}))
    with patch.object(jira.time, 'monotonic', side_effect=[0, 46]):
        with case.assertRaises(jira.JiraError) as caught:
            client.get_request('SUP-1')
    assert caught.exception.code == 'UNAVAILABLE'
    assert 'private' not in str(caught.exception)
    assert client._session.get.call_count == 1
    client.close()


if __name__ == '__main__':
    suite = unittest.TestSuite(
        unittest.FunctionTestCase(test)
        for name, test in list(globals().items())
        if name.startswith('test_') and callable(test)
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
