"""Database models for the Brainwaves Formbricks application.

This module defines the SQLAlchemy ORM models and database connection setup
for the application's PostgreSQL database.
"""

import os
from fastapi import Depends
from typing import AsyncGenerator, Optional
from sqlalchemy import Column, String, Boolean, create_engine, Integer, Text, Engine
from sqlalchemy.orm import declarative_base, Mapped, relationship, sessionmaker
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from fastapi_users.db import (
    SQLAlchemyBaseUserTableUUID,
    SQLAlchemyUserDatabase,
)
from urllib.parse import urlparse

# Database configuration
POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")
POSTGRES_DB = os.getenv("POSTGRES_DB", "fastapi_db")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "postgres")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")

if not POSTGRES_PASSWORD:
    raise ValueError("POSTGRES_PASSWORD environment variable must be set")

# Construct database URLs
db_url = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
SYNC_DATABASE_URL = f"postgresql+psycopg2://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
ASYNC_DATABASE_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

# Base class for ORM models
Base = declarative_base()

class ProfilerType(Base):
    """
    Represents a type of profiler assessment with its configuration.
    
    Attributes:
        name: Unique identifier for the profiler type
        filename: Name of the JSON file containing profiler configuration
    """
    __tablename__ = "profilerTypes"
    
    name: Mapped[str] = Column(String, primary_key=True, index=True)
    filename: Mapped[str] = Column(String, index=True)

class Group(Base):
    """
    Represents a group of profiles, typically a class or cohort.
    
    Attributes:
        name: Unique identifier for the group
        displayAs: Human-readable name for the group
        token: Unique access token for the group
        archived: Whether the group is archived
        profilerTypeName: The type of profiler assessment used
        hasProfiles: Whether the group contains any profiles
        emoji: Icon representation for the group
    """
    __tablename__ = "groups"
    
    name: Mapped[str] = Column(String, primary_key=True, index=True)
    displayAs: Mapped[str] = Column(String, index=True)
    token: Mapped[str] = Column(String, index=True, unique=True)
    archived: Mapped[bool] = Column(Boolean, index=True)
    profilerTypeName: Mapped[str] = Column(String, index=True)
    hasProfiles: Mapped[bool] = Column(Boolean, index=True)
    emoji: Mapped[str] = Column(String, index=True)

class Profile(Base):
    """
    Represents an individual assessment profile.
    
    Attributes:
        id: Unique identifier for the profile
        name: Name of the student/subject
        groupName: The group this profile belongs to
        profilerTypeName: The type of assessment used
        status: Current status of the profile (e.g., "Complete", "Incomplete")
    """
    __tablename__ = "profiles"
    
    id: Mapped[str] = Column(String, primary_key=True, index=True)
    name: Mapped[str] = Column(String, index=True)
    groupName: Mapped[str] = Column(String, index=True)
    profilerTypeName: Mapped[str] = Column(String, index=True)
    status: Mapped[str] = Column(String, index=True)

class Answer(Base):
    """
    Represents a single answer in a profile assessment.
    
    Attributes:
        id: Unique identifier for the answer
        profileId: ID of the profile this answer belongs to
        question: The question being answered
        score: Numerical score given as the answer
        domain: The domain/category this question belongs to
    """
    __tablename__ = "answers"
    
    id: Mapped[str] = Column(String, primary_key=True, index=True)
    profileId: Mapped[str] = Column(String, index=True)
    question: Mapped[str] = Column(String, index=True)
    score: Mapped[int] = Column(Integer, index=True)
    domain: Mapped[str] = Column(String, index=True)

class Configuration(Base):
    """
    Represents a system configuration key-value pair.
    
    Attributes:
        key: Unique identifier for the configuration
        value: The configuration value
        write_only: Whether the value can only be written, not read
        superuser_only: Whether only superusers can access this configuration
    """
    __tablename__ = "configurations"
    
    key: Mapped[str] = Column(String, primary_key=True, index=True)
    value: Mapped[str] = Column(Text, nullable=False)
    write_only: Mapped[bool] = Column(Boolean, default=False, nullable=False)
    superuser_only: Mapped[bool] = Column(Boolean, default=False, nullable=False)

class User(SQLAlchemyBaseUserTableUUID, Base):
    """
    Represents a system user with authentication capabilities.
    
    Attributes:
        changePasswordOnLogin: Whether the user must change their password on next login
    """
    changePasswordOnLogin: Mapped[bool] = Column(Boolean, index=True)

# Database engine setup
sync_engine: Engine = create_engine(SYNC_DATABASE_URL)
async_engine = create_async_engine(ASYNC_DATABASE_URL)

async_session_maker = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)

async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Create and yield an async database session.
    
    Yields:
        AsyncSession: An async SQLAlchemy session
    """
    async with async_session_maker() as session:
        yield session

async def get_user_db(
    session: AsyncSession = Depends(get_async_session)
) -> AsyncGenerator[SQLAlchemyUserDatabase, None]:
    """
    Create and yield a FastAPI Users database session.
    
    Args:
        session: The async SQLAlchemy session
        
    Yields:
        SQLAlchemyUserDatabase: A database session for user management
    """
    yield SQLAlchemyUserDatabase(session, User)