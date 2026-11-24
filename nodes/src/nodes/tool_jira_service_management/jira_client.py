"""Bounded read-only Jira Service Management Cloud client."""

import json
import re
import time

_HOST = re.compile(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$')
_KEY = re.compile(r'^(?:[A-Za-z][A-Za-z0-9_]{0,49}-[1-9][0-9]{0,15}|[1-9][0-9]{0,19})$')
_CLOUD_ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
_BEARER = re.compile(r'^[A-Za-z0-9._~+/\-=]+$')
_MAX_BYTES = 1024 * 1024
_MAX_READ_SECONDS = 45
_RESOURCE_URL = 'https://api.atlassian.com/oauth/token/accessible-resources'


class JiraError(Exception):
    """A sanitized failure suitable for returning to callers."""

    def __init__(self, code, message, *, retry_after_seconds=None):
        super().__init__(message)
        self.code = code
        self.retry_after_seconds = retry_after_seconds


def _retry_after(headers):
    """Return only a bounded numeric Retry-After, never arbitrary provider text."""
    value = headers.get('Retry-After')
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,6}', value):
        return None
    seconds = int(value)
    return seconds if seconds <= 86400 else None


def _unique_object(pairs):
    """Reject ambiguous object fields instead of silently choosing a value."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON field.')
        result[key] = value
    return result


def _reject_json_constant(_value):
    """JSON does not support NaN or infinity."""
    raise ValueError('Invalid JSON constant.')


def validate_config(config):
    """Only Atlassian Cloud tenant hosts are supported by this node."""
    mode = config.get('authMode', 'basic')
    if mode not in ('basic', 'scoped_basic', 'oauth'):
        raise ValueError('Authentication mode must be basic, scoped_basic, or oauth.')
    host = config.get('domain', '')
    if not isinstance(host, str) or (host and not _HOST.fullmatch(host)) or (mode != 'scoped_basic' and not host):
        raise ValueError('Domain must be a lowercase Atlassian Cloud hostname, such as example.atlassian.net.')
    fields = (
        ('email', 'apiToken')
        if mode == 'basic'
        else ('email', 'apiToken', 'cloudId')
        if mode == 'scoped_basic'
        else ('cloudId', 'accessToken')
    )
    for field in fields:
        value = config.get(field)
        if (
            not isinstance(value, str)
            or not value.strip()
            or len(value) > 4096
            or '${' in value
            or any(ord(c) < 32 for c in value)
        ):
            raise ValueError(f'{field} must be configured.')
    if mode in ('basic', 'scoped_basic'):
        if (
            not config['email'].isascii()
            or not re.fullmatch(r'[^\s:@]+@[^\s:@]+', config['email'])
            or len(config['email']) > 254
        ):
            raise ValueError('Account email must be an ASCII email address.')
        if not config['apiToken'].isascii() or any(char.isspace() for char in config['apiToken']):
            raise ValueError('API token contains unsupported characters.')
    if mode in ('oauth', 'scoped_basic'):
        if not _CLOUD_ID.fullmatch(config['cloudId']):
            raise ValueError('Cloud ID must be a canonical lowercase UUID.')
    if mode == 'oauth':
        if not _BEARER.fullmatch(config['accessToken']):
            raise ValueError('Access token contains unsupported characters.')
        if config.get('apiToken'):
            raise ValueError('Do not configure an API token in OAuth mode.')
    elif config.get('accessToken'):
        raise ValueError('Do not configure an OAuth access token in basic mode.')


def _request_item(value, include_summary=False):
    if (
        not isinstance(value, dict)
        or not isinstance(value.get('issueKey'), str)
        or not _KEY.fullmatch(value['issueKey'])
    ):
        raise JiraError('INVALID_RESPONSE', 'Jira returned an invalid customer request.')
    status = value.get('currentStatus')
    created = value.get('createdDate')

    def limited(item, length):
        if item is None:
            return None
        if not isinstance(item, str) or len(item) > length or any(not char.isprintable() for char in item):
            raise JiraError('INVALID_RESPONSE', 'Jira returned invalid request metadata.')
        return item

    if status is not None and not isinstance(status, dict):
        raise JiraError('INVALID_RESPONSE', 'Jira returned invalid request status.')
    if created is not None and not isinstance(created, dict):
        raise JiraError('INVALID_RESPONSE', 'Jira returned invalid request creation data.')

    result = {
        'issue_key': value['issueKey'],
        'status': limited(status.get('status'), 200) if isinstance(status, dict) else None,
        'created': limited(created.get('iso8601'), 100) if isinstance(created, dict) else None,
        'service_desk_id': limited(value.get('serviceDeskId'), 100),
        'request_type_id': limited(value.get('requestTypeId'), 100),
    }
    if include_summary:
        fields = value.get('requestFieldValues')
        if fields is not None and (
            not isinstance(fields, list) or len(fields) > 100 or any(not isinstance(field, dict) for field in fields)
        ):
            raise JiraError('INVALID_RESPONSE', 'Jira returned invalid request fields.')
        matches = [field for field in (fields or []) if field.get('fieldId') == 'summary']
        if len(matches) > 1:
            raise JiraError('INVALID_RESPONSE', 'Jira returned ambiguous request summary fields.')
        nested_summary = limited(matches[0].get('value'), 255) if matches else None
        top_summary = limited(value.get('summary'), 255)
        if nested_summary is not None and top_summary is not None and nested_summary != top_summary:
            raise JiraError('INVALID_RESPONSE', 'Jira returned conflicting request summaries.')
        result['summary'] = nested_summary if nested_summary is not None else top_summary
    return result


class JiraClient:
    """Use fixed Cloud routes, disallow redirects, and return selected fields."""

    def __init__(self, config):
        validate_config(config)
        import requests
        from requests.auth import HTTPBasicAuth

        self._requests = requests
        self._mode = config.get('authMode', 'basic')
        self._domain = config.get('domain', '')
        self._cloud_id = config.get('cloudId', '')
        self._session = requests.Session()
        if self._mode == 'oauth':

            class BearerAuth(requests.auth.AuthBase):
                def __init__(self, token):
                    self._token = token

                def __call__(self, request):
                    request.headers['Authorization'] = 'Bearer ' + self._token
                    return request

            self._session.auth = BearerAuth(config['accessToken'])
            self._base = 'https://api.atlassian.com/ex/jira/' + self._cloud_id + '/rest/servicedeskapi/request'
        elif self._mode == 'scoped_basic':
            self._session.auth = HTTPBasicAuth(config['email'], config['apiToken'])
            self._base = 'https://api.atlassian.com/ex/jira/' + self._cloud_id + '/rest/servicedeskapi/request'
        else:
            self._session.auth = HTTPBasicAuth(config['email'], config['apiToken'])
            self._base = 'https://' + self._domain + '/rest/servicedeskapi/request'
        self._session.headers.update({'Accept': 'application/json'})

    def close(self):
        self._session.close()
        self._session.auth = None

    def _get_json(self, url, params=None):
        deadline = time.monotonic() + _MAX_READ_SECONDS
        try:
            with self._session.get(url, params=params, timeout=(5, 20), allow_redirects=False, stream=True) as response:
                if time.monotonic() >= deadline:
                    raise JiraError('UNAVAILABLE', 'Jira response exceeded the read time limit.')
                if response.status_code != 200:
                    code = {
                        401: 'AUTHENTICATION',
                        403: 'FORBIDDEN',
                        404: 'NOT_FOUND',
                        429: 'RATE_LIMITED',
                        503: 'UNAVAILABLE',
                    }.get(response.status_code, 'API_ERROR')
                    retry = _retry_after(response.headers) if response.status_code in (429, 503) else None
                    raise JiraError(
                        code,
                        'Jira request failed; check access, configuration, and service status.',
                        retry_after_seconds=retry,
                    )
                raw = bytearray()
                for chunk in response.iter_content(chunk_size=65536):
                    if time.monotonic() >= deadline:
                        raise JiraError('UNAVAILABLE', 'Jira response exceeded the read time limit.')
                    raw.extend(chunk)
                    if len(raw) > _MAX_BYTES:
                        raise JiraError('INVALID_RESPONSE', 'Jira response exceeded the size limit.')
                try:
                    data = json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_reject_json_constant)
                except (ValueError, UnicodeError, RecursionError):
                    raise JiraError('INVALID_RESPONSE', 'Jira returned invalid JSON.') from None
                return data
        except self._requests.RequestException:
            raise JiraError('UNAVAILABLE', 'Jira could not be reached or the request timed out.') from None

    def _verify_oauth_resource(self):
        """Recheck the configured site and read scopes for this token on each operation."""
        resources = self._get_json(_RESOURCE_URL)
        if not isinstance(resources, list) or len(resources) > 1000:
            raise JiraError('INVALID_RESPONSE', 'Atlassian returned an invalid resource list.')
        matching = []
        for resource in resources:
            if not isinstance(resource, dict) or resource.get('id') != self._cloud_id:
                continue
            if resource.get('url') not in ('https://' + self._domain, 'https://' + self._domain + '/'):
                continue
            scopes = resource.get('scopes')
            if not isinstance(scopes, list) or not all(isinstance(scope, str) for scope in scopes):
                raise JiraError('INVALID_RESPONSE', 'Atlassian returned invalid resource scopes.')
            if 'read:servicedesk-request' in scopes or {
                'read:request:jira-service-management',
                'read:user:jira',
            }.issubset(scopes):
                matching.append(resource)
        if len(matching) != 1:
            raise JiraError('RESOURCE_ACCESS', 'The configured Jira site and read scopes could not be verified.')

    def _get(self, suffix='', params=None):
        if self._mode == 'oauth':
            self._verify_oauth_resource()
        data = self._get_json(self._base + suffix, params=params)
        if not isinstance(data, dict):
            raise JiraError('INVALID_RESPONSE', 'Jira returned an invalid response.')
        return data

    def get_request(self, key, include_summary=False):
        if not isinstance(key, str) or not _KEY.fullmatch(key):
            raise JiraError('INVALID_INPUT', 'Enter a Jira request key or numeric ID.')
        if type(include_summary) is not bool:
            raise JiraError('INVALID_INPUT', 'include_summary must be a boolean.')
        value = self._get('/' + key)
        item = _request_item(value, include_summary=include_summary)
        if (key.isdigit() and value.get('issueId') != key) or (
            not key.isdigit() and item['issue_key'].lower() != key.lower()
        ):
            raise JiraError('INVALID_RESPONSE', 'Jira returned a different customer request.')
        return item

    def list_requests(self, start=0, limit=20):
        if type(start) is not int or not 0 <= start <= 1000 or type(limit) is not int or not 1 <= limit <= 50:
            raise JiraError('INVALID_INPUT', 'Invalid pagination.')
        data = self._get(params={'start': start, 'limit': limit})
        values = data.get('values')
        if (
            not isinstance(values, list)
            or type(data.get('start')) is not int
            or data['start'] != start
            or type(data.get('limit')) is not int
            or not 1 <= data['limit'] <= limit
            or type(data.get('size')) is not int
            or data['size'] != len(values)
            or len(values) > data['limit']
            or not isinstance(data.get('isLastPage'), bool)
        ):
            raise JiraError('INVALID_RESPONSE', 'Jira returned an invalid request page.')
        requests = [_request_item(item) for item in values]
        if len({item['issue_key'].casefold() for item in requests}) != len(requests):
            raise JiraError('INVALID_RESPONSE', 'Jira returned duplicate requests in the page.')
        return {
            'requests': requests,
            'start': data['start'],
            'limit': data['limit'],
            'size': data['size'],
            'last_page': data['isLastPage'],
        }
