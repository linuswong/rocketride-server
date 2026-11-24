"""Offline JSON-lines bridge to the Auth0 node and RocketRide dispatcher."""

import importlib.util
import json
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(root / 'dist' / 'server' / 'lib' / 'site-packages'))
import pytest  # noqa: E402

sys.path.insert(0, str(root / 'nodes' / 'test' / 'tool_auth0'))
import test_auth0_tools  # noqa: E402
import test_configuration  # noqa: E402

patch = pytest.MonkeyPatch()
generator = test_configuration.node.__wrapped__(patch)
node = next(generator)
base_tool = test_auth0_tools.tool.__wrapped__(node)
if os.environ.get('LOGINLENS_TEST_LEGACY_NODE') == '1':
    patch.delitem(
        base_tool[0].get_log_event.__func__.__tool_meta__['input_schema']['properties'], 'include_fingerprint'
    )
instance, _ = test_auth0_tools.dispatched_tool.__wrapped__(base_tool, patch)
spec = importlib.util.spec_from_file_location('requests', Path(__file__).parent / 'auth0-mock' / 'requests.py')
fixture_requests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_requests)
patch.setitem(sys.modules, 'requests', fixture_requests)
client = base_tool[2].Auth0Client(
    {'domain': 'loginlens-fixture.auth0.com', 'clientId': 'fixture-client', 'clientSecret': 'fixture-secret'}
)
instance.IGlobal.client = client
try:
    for line in sys.stdin:
        request = json.loads(line)
        result = instance._dispatch_tool({'tool_name': request['tool'], 'input': request['input']}, 'tool.invoke')
        print(json.dumps({'id': request['id'], 'output': result['output']}), flush=True)
finally:
    client.close()
    generator.close()
    patch.undo()
