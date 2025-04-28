"""Authentication module for the Brainwaves FastAPI application.

This module handles user authentication using FastAPI-Users and JWT tokens.
It provides user management, authentication backends, and user schemas.
"""

import sys
import os
import uuid
import asyncio
import contextlib
import secrets
import string
from typing import Optional, Dict, Any, Union, AsyncGenerator
from fastapi import Request, HTTPException, Depends, status
from fastapi.responses import Response
from fastapi_users import FastAPIUsers, BaseUserManager, UUIDIDMixin, schemas
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users.authentication import (
    JWTStrategy,
    BearerTransport,
    AuthenticationBackend,
    Strategy,
)
from fastapi_users.password import PasswordHelper
from fastapi_users.exceptions import UserAlreadyExists
from pydantic import BaseModel, Field

sys.path.append(os.path.abspath("/app/api"))
from bwjwt import SECRET_KEY_PEM, PUBLIC_KEY_PEM
from models import User, get_user_db, get_async_session

class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    """Manager for handling user-related operations."""
    reset_password_token_secret = SECRET_KEY_PEM
    verification_token_secret = SECRET_KEY_PEM
    
    # Configure password helper with default settings for fastapi-users 14
    password_helper = PasswordHelper()

    async def on_after_login(self, user: User, request: Optional[Request] = None, response: Optional[Response] = None):
        """Handle actions after a user logs in."""
        if user.changePasswordOnLogin:
            if response:
                response.headers["X-Password-Change-Required"] = "true"

    async def on_after_register(self, user: User, request: Optional[Request] = None):
        """Handle actions after a user registers."""
        update_dict = {"changePasswordOnLogin": True}
        await self.user_db.update(user, update_dict)

    async def on_after_update(self, user: User, update_dict: Dict[str, Any], request: Optional[Request] = None):
        """Handle actions after a user is updated."""
        if "password" in update_dict:
            new_update_dict = {"changePasswordOnLogin": False}
            await self.user_db.update(user, new_update_dict)

class UserRead(schemas.BaseUser[uuid.UUID]):
    """Schema for reading user data."""
    changePasswordOnLogin: bool    
    pass

class UserCreate(schemas.BaseUserCreate):
    """Schema for creating a new user."""
    pass

class UserUpdate(schemas.BaseUserUpdate):
    """Schema for updating user data."""
    pass

async def get_user_manager(user_db: SQLAlchemyUserDatabase = Depends(get_user_db)):
    """Dependency to get the user manager."""
    yield UserManager(user_db)

get_async_session_context = contextlib.asynccontextmanager(get_async_session)
get_user_db_context = contextlib.asynccontextmanager(get_user_db)
get_user_manager_context = contextlib.asynccontextmanager(get_user_manager)

def generateRandomPassword(length: int = 8) -> str:
    """
    Generate a random password with the specified length.
    The password includes letters, digits, and common symbols that are easy to recognize and type.
    """
    # Define the character pool: letters, digits, and common symbols
    easy_to_type_symbols = "!@#%&*?"
    character_pool = string.ascii_letters + string.digits + easy_to_type_symbols
    # Generate the password using a cryptographically secure random choice
    password = ''.join(secrets.choice(character_pool) for _ in range(length))
    return password

async def SuperCreateUser(email: str, password: str = generateRandomPassword(), is_superuser: bool = False) -> Dict[str, Union[str, bool]]:
    """
    Create a superuser with the given email and password.
    If no password is provided, a random password is generated.
    """
    try:
        async with get_async_session_context() as session:
            async with get_user_db_context(session) as user_db:
                async with get_user_manager_context(user_db) as user_manager:
                    user = await user_manager.create(
                        UserCreate(
                            email=email, password=password, is_superuser=is_superuser
                        )
                    )
                    print(f"User created {email}")
                    return {
                        'id': str(user.id),
                        'email': user.email,
                        'password': password,
                        'is_active': user.is_active,
                        'is_verified': user.is_verified,
                        'is_superuser': user.is_superuser,
                        'changePasswordOnLogin': user.changePasswordOnLogin
                    }
    except UserAlreadyExists:
        print(f"User {email} already exists")
        raise

bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")

def get_jwt_strategy() -> JWTStrategy:
    """Get the JWT strategy for authentication."""
    return JWTStrategy(secret=SECRET_KEY_PEM, lifetime_seconds=3600, algorithm="RS256", public_key=PUBLIC_KEY_PEM)

auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

# Getting the current user as a dependency...
# ===========================================

# Dependency: user is logged in, or dependency not fulfilled
# ---
# If used as a dependency, fails if user is not logged in
current_user = fastapi_users.current_user(active=True)

# Dependency: user is logged in, or returns none (login optional)
# ---
# Returns None if user is not logged in but does not error/fail, allowing method to apply custom authz logic
opt_current_user = fastapi_users.current_user(active=True, optional=True)

# Dependency: user is logged in and does not need password change, or returns none (login optional)
# ---
# Raises 403 if user is logged in but needs to change password
# Returns None if not logged in (this makes it optional, so dependency still resolves if not logged in)
# Returns user object if logged in with valid password
async def opt_current_user_valid_pw(
        user: User = Depends(opt_current_user),
) -> Optional[User]:
    """Dependency to get the current user if logged in and password is valid."""
    if user:
        if user.changePasswordOnLogin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Password change required. Please update your password."
            )
    return user

# Dependency: user is logged in and does not need password change, or dependency not fulfilled
# ---
# Raises 403 if user is logged in but needs to change password
# Returns user object if logged in with valid password
async def current_user_valid_pw(
        user: User = Depends(current_user),
) -> User:
    """Dependency to get the current user if logged in and password is valid."""
    if user:
        if user.changePasswordOnLogin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Password change required. Please update your password."
            )
    return user

# Dependency: user is logged in, is SUPER, and does not need password change, or dependency not fulfilled
# ---
# Returns 403 if user is not super
# Raises 403 if user is logged in but needs to change password
# Returns user object if logged in with valid password
async def current_superuser_valid_pw(user: User = Depends(current_user)) -> User:
    """Dependency to get the current superuser if logged in and password is valid."""
    if user:
        if not user.is_superuser:
            raise HTTPException(status_code=403, detail="Not authorised")
        if user.changePasswordOnLogin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Password change required. Please update your password."
            )
    return user