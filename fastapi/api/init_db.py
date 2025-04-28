"""Database initialization and management module.

This module provides utilities for initializing the database, creating users,
and managing database records. It includes functions for creating tables,
adding initial data, and managing user creation.
"""

import asyncio
import contextlib
import os
import sys
from pprint import pprint
from typing import Any, Dict, List, Optional

from fastapi_users.exceptions import UserAlreadyExists
from sqlalchemy import inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import MetaData
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.ext.declarative import DeclarativeMeta

sys.path.append(os.path.abspath("/app"))
from api.models import (
    Answer, 
    Base, 
    Group, 
    Profile, 
    ProfilerType,
    async_engine,
    sync_engine,
    get_async_session,
    get_user_db,
)
from api.auth import get_user_manager, UserCreate, SuperCreateUser

# Database engine configuration
engine: Engine = sync_engine

# Create sync and async session factories for the database
AsyncSessionLocal = async_session_maker = async_sessionmaker(
    bind=async_engine, 
    expire_on_commit=False
)
SyncSessionLocal = sessionmaker(
    autocommit=False, 
    autoflush=False, 
    bind=sync_engine
)
SessionLocal = SyncSessionLocal

# Auth context managers
get_async_session_context = contextlib.asynccontextmanager(get_async_session)
get_user_db_context = contextlib.asynccontextmanager(get_user_db)
get_user_manager_context = contextlib.asynccontextmanager(get_user_manager)

def print_all_records() -> None:
    """Print all records and row counts for each table in the database.
    
    This function iterates through all mapped classes from the Base model,
    queries their records, and prints both the total row count and the
    contents of each record.
    """
    with SessionLocal() as session:
        # Get all mapped classes from Base
        mapped_classes = Base.__subclasses__()

        for cls in mapped_classes:
            print(f"\nTable: {cls.__tablename__}")
            
            # Query the total row count
            row_count = session.query(cls).count()
            print(f"Total Rows: {row_count}")
            
            # Fetch and display all records
            records = session.query(cls).all()
            if records:
                for record in records:
                    print(record.__dict__)  # Print record as a dictionary
            else:
                print("No records found.")

async def create_user(
    email: str, 
    password: str, 
    is_superuser: bool = False
) -> Any:
    """Create a new user in the database.

    Args:
        email: The email address for the new user
        password: The password for the new user
        is_superuser: Whether the user should have superuser privileges

    Returns:
        The created user object

    Raises:
        UserAlreadyExists: If a user with the given email already exists
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
                    print(f"User created {user}")
                    return user
    except UserAlreadyExists:
        print(f"User {email} already exists")
        raise

def init_db() -> None:
    """Initialize the database with default data.
    
    This function:
    1. Drops all existing tables
    2. Creates new tables
    3. Inserts initial data for groups, profiler types, profiles, and answers
    4. Creates a default superuser admin account
    """
    # Drop all tables
    metadata = MetaData()
    metadata.reflect(bind=engine)
    metadata.drop_all(bind=engine)

    # Create all tables
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as session:
        session.execute(
            Group.__table__.insert(),
            [
                {
                    "name": "Year 1 (2024)", 
                    "archived": False, 
                    "displayAs":"Year 1", 
                    "token":"123456", 
                    "profilerTypeName":"KS1 Assessment",
                    "hasProfiles":False,
                    "emoji":"🧠"
                },
                {
                    "name": "Year 3 (2024)", 
                    "archived": False, 
                    "displayAs":"Year 3", 
                    "token":"123457", 
                    "profilerTypeName":"KS2 Assessment",
                    "hasProfiles":False,
                    "emoji":"🧠"
                }
            ],
        )
        session.execute(
            ProfilerType.__table__.insert(),
            [
                {"name": "KS1 Assessment", "filename":"ks1.json"},
                {"name": "KS2 Assessment", "filename":"ks2.json"},
                {"name": "Combined SpLD Checklist: Primary Level (ages 6-11)", "filename":"combined-spld-checklist-primary.json"},
            ],
        )
        session.execute(
            Profile.__table__.insert(),
            [
                {
                    "id": "12345678", 
                    "name": "A Name", 
                    "groupName":"Year 3 (2024)",  
                    "profilerTypeName":"KS2 Assessment",
                    "status":"Complete"
                },
                {
                    "id": "12345679", 
                    "name": "Another Name", 
                    "groupName":"Year 3 (2024)",  
                    "profilerTypeName":"KS2 Assessment",
                    "status":"Complete"
                },
                {
                    "id": "12345680", 
                    "name": "Another Name Again", 
                    "groupName":"Year 1 (2024)",  
                    "profilerTypeName":"KS1 Assessment",
                    "status":"Complete"
                }
            ],
        )
        session.execute(
            Answer.__table__.insert(),
            [
                {
                    "id": "658435613655", 
                    "profileId": "12345680", 
                    "question":"Q1",  
                    "score":0,
                    "domain":"Attention"
                },
                {
                    "id": "658435613656", 
                    "profileId": "12345680", 
                    "question":"Q2",  
                    "score":1,
                    "domain":"Attention"
                },
                {
                    "id": "658435613657", 
                    "profileId": "12345680", 
                    "question":"Q3",  
                    "score":2,
                    "domain":"Sensory"
                },
                {
                    "id": "658435613658", 
                    "profileId": "12345680", 
                    "question":"Q4",  
                    "score":1,
                    "domain":"Sensory"
                },
                {
                    "id": "658435613659", 
                    "profileId": "12345680", 
                    "question":"Q5",  
                    "score":2,
                    "domain":"Organization"
                },
                {
                    "id": "658435613660", 
                    "profileId": "12345680", 
                    "question":"Q6",  
                    "score":2,
                    "domain":"Organization"
                },
                {
                    "id": "658435613661", 
                    "profileId": "12345680", 
                    "question":"Q7",  
                    "score":0,
                    "domain":"Adaptability"
                },
                {
                    "id": "658435613662", 
                    "profileId": "12345680", 
                    "question":"Q8",  
                    "score":0,
                    "domain":"Adaptability"
                },
                {
                    "id": "658435613665", 
                    "profileId": "12345680", 
                    "question":"Q11",  
                    "score":0,
                    "domain":"Social"
                },
                {
                    "id": "658435613666", 
                    "profileId": "12345680", 
                    "question":"Q12",  
                    "score":2,
                    "domain":"Social"
                }
            ],
        )
        session.commit()

    user = asyncio.run(SuperCreateUser('admin@admin.com',is_superuser=True))
    print(" ")
    print("!----------------------------!")
    print(" ")
    print("Admin username : "+user['email'])
    print("Admin password : "+user['password'])
    print(" ")
    print("!----------------------------!")
    print(" ")

    print("Database initialised!")
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print(tables)
    print_all_records()

if __name__ == "__main__":
    init_db_value = os.getenv('INIT_DB', '').lower().strip()
    if init_db_value in ('true', '1', 'yes'):
        print("INIT_DB.PY: Starting database initialization...")
        init_db()
    else:
        print(f"INIT_DB.PY: Skipping initialization (INIT_DB={init_db_value})")
