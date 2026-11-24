"""Minimal auth types for the offline Jira transport fixture."""


class AuthBase:
    pass


class HTTPBasicAuth(AuthBase):
    def __init__(self, username, password):
        self.username = username
        self.password = password
