from setuptools import setup, find_packages

setup(
    name="brainwaves-api",
    version="0.1.0",
    packages=find_packages(),
    package_dir={"": "."},
    install_requires=[
        "fastapi",
        "uvicorn",
        "sqlalchemy",
        "fastapi-users",
        "asyncpg",
        "psycopg2-binary",
        "python-multipart",
        "python-jose[cryptography]",
        "passlib[bcrypt]",
        "pyjwt",
        "email-validator",
        "aiofiles",
    ],
)