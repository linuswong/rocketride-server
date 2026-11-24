"""Shared Jira client lifecycle."""

from pathlib import Path

from ai.common.config import Config
from rocketlib import IGlobalBase, OPEN_MODE, warning

from .jira_client import JiraClient, validate_config


class IGlobal(IGlobalBase):
    client = None

    def beginGlobal(self):
        if self.IEndpoint.endpoint.openMode == OPEN_MODE.CONFIG:
            return
        cfg = Config.getNodeConfig(self.glb.logicalType, self.glb.connConfig)
        validate_config(cfg)
        from depends import depends

        depends(str(Path(__file__).parent / 'requirements.txt'))
        self.client = JiraClient(cfg)

    def validateConfig(self):
        try:
            validate_config(Config.getNodeConfig(self.glb.logicalType, self.glb.connConfig))
        except ValueError as exc:
            warning(str(exc))

    def endGlobal(self):
        if self.client is not None:
            self.client.close()
        self.client = None
