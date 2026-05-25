"""Custom JWT tokens for LabConnect.

Two extra claims are issued on every token pair:

- `roles`         : list of Django Group names (avoids extra DB hits client-side)
- `totp_verified` : bool — currently mocked to True (see step §2 demo).

simplejwt's `RefreshToken.access_token` property copies every non-blacklisted
claim from the refresh token onto the access token, so we **set the claims on
the refresh token** (not the access). Setting them only on the access class
would be ineffective because `RefreshToken.for_user` doesn't go through
`AccessToken.for_user`.
"""
from __future__ import annotations

from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from core.permissions import RoleNames

STAFF_ROLES = set(RoleNames.ALL_STAFF)


class LabConnectAccessToken(AccessToken):
    """Access token type tag — claims are copied from the refresh token."""


class LabConnectRefreshToken(RefreshToken):
    access_token_class = LabConnectAccessToken

    @classmethod
    def for_user(cls, user):  # type: ignore[override]
        token = super().for_user(user)
        roles = list(user.groups.values_list("name", flat=True))
        token["roles"] = roles
        # 2FA mocked: tous les utilisateurs sont considérés vérifiés.
        # À réactiver : remettre `not bool(STAFF_ROLES.intersection(roles))`.
        token["totp_verified"] = True
        return token
