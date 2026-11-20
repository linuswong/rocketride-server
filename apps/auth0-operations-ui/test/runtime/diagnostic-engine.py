"""Test-only parent instrumentation; never prints task data or environment values."""

import asyncio
import json
import os
import re

from ai.common.dap.transport_stdio import TransportStdio
from ai.modules.task.task_engine import Task


def emit(**fields):
    print('LOGINLENS_DIAG ' + json.dumps(fields), flush=True)


original_spawn = asyncio.create_subprocess_exec


async def spawn(executable, *args, **kwargs):
    if args and str(args[0]).replace('\\', '/').endswith('/ai/node.py'):
        flags = [str(arg).split('=')[0] for arg in args[2:] if str(arg).startswith('--')]
        emit(
            event='spawn',
            executable=os.path.basename(executable),
            script='ai/node.py',
            cwd_is_engine=kwargs.get('cwd') == os.path.dirname(executable),
            flags=flags,
        )
    return await original_spawn(executable, *args, **kwargs)


asyncio.create_subprocess_exec = spawn

original_message = TransportStdio._process_message


async def message(self, channel, value):
    if value:
        kind = value.split('*', 1)[0] if value.startswith('>') else 'text'
        exception = re.search(r'\b([A-Za-z_][A-Za-z_0-9]*(?:Error|Exception))\b', value)
        frame = re.search(r'File "([^"]+)", line (\d+)', value)
        fatal = re.search(r'Windows fatal exception: code (0x[0-9a-fA-F]+)', value)
        emit(
            event='child_output',
            channel=channel,
            kind=kind,
            exception=exception.group(1) if exception else None,
            frame=os.path.basename(frame.group(1)) if frame else None,
            line=int(frame.group(2)) if frame else None,
            fatal_code=fatal.group(1) if fatal else None,
        )
    return await original_message(self, channel, value)


TransportStdio._process_message = message

original_status = Task._send_status_update


async def status(self, *args, **kwargs):
    emit(event='state', state=self._status.state)
    return await original_status(self, *args, **kwargs)


Task._send_status_update = status

original_exit = Task._apply_process_exit_code


def process_exit(self, code):
    emit(
        event='exit',
        code=code,
        signal=-code if os.name == 'posix' and code is not None and code < 0 else None,
        requested=bool(self._stop_requested),
        exit_event=bool(self._exit_event_seen),
    )
    return original_exit(self, code)


Task._apply_process_exit_code = process_exit

from ai.eaas import main

main()
