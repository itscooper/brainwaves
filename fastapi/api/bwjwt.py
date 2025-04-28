"""JWT authentication utilities for the Brainwaves application.

This module handles JSON Web Token (JWT) creation and validation using RSA keys
for secure authentication. It uses asymmetric cryptography (RSA) for enhanced
security compared to symmetric algorithms.

Security Notes:
- RSA-2048 keys are used for signing
- Keys are persisted to disk and loaded on startup
- Tokens include standard claims (sub, iat, exp)
- RS256 algorithm is used for signatures
"""

import datetime
import os
import json
from typing import Dict, Optional, Any
from jwcrypto import jwt, jwk

# Constants
KEY_FILE: str = "private_key.json"
KEY_SIZE: int = 2048  # RSA key size in bits
JWT_ALGORITHM: str = "RS256"

def load_or_generate_key() -> jwk.JWK:
    """
    Load or generate an RSA key for JWT signing.
    
    Attempts to load an existing key from KEY_FILE. If the file doesn't exist,
    generates a new 2048-bit RSA key and saves it for future use.
    
    Returns:
        jwk.JWK: A JWK object containing the RSA key pair
        
    Security:
        - Uses 2048-bit RSA keys (industry standard)
        - Persists private key securely to disk
        - Should be backed up securely in production
    """
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "r") as f:
            return jwk.JWK.from_json(f.read())
    else:
        new_key = jwk.JWK.generate(kty="RSA", size=KEY_SIZE)
        with open(KEY_FILE, "w") as f:
            f.write(new_key.export_private())
        return new_key

# Initialize the signing key
SECRET_KEY: jwk.JWK = load_or_generate_key()
SECRET_KEY_PEM: str = SECRET_KEY.export_to_pem(private_key=True, password=None).decode("utf-8")
PUBLIC_KEY_PEM: str = SECRET_KEY.export_to_pem(private_key=False, password=None).decode("utf-8")

def createJwt(
    subject: str,
    claims: Optional[Dict[str, Any]] = None,
    expiry_days: int = 365
) -> str:
    """
    Create and sign a new JWT.
    
    Creates a token with standard claims (sub, iat, exp) and any additional
    claims provided. Signs the token using RS256 with the application's RSA key.
    
    Args:
        subject: The subject identifier (e.g., user ID or profile ID)
        claims: Optional additional claims to include in the token
        expiry_days: Number of days until the token expires
        
    Returns:
        str: The signed JWT as a string
        
    Example:
        >>> token = createJwt("user123", {"role": "admin"}, 30)
        >>> # Creates a token valid for 30 days with role=admin
    """
    if claims is None:
        claims = {}

    now = datetime.datetime.utcnow()
    expiry = now + datetime.timedelta(days=expiry_days)

    # Construct payload with standard claims
    payload = {
        "sub": subject,  # Subject (e.g., user ID)
        "iat": int(now.timestamp()),  # Issued at
        "exp": int(expiry.timestamp()),  # Expiry
        **claims,  # Additional claims
    }

    # Create and sign token
    token = jwt.JWT(
        header={"alg": JWT_ALGORITHM},
        claims=payload
    )
    token.make_signed_token(SECRET_KEY)

    return token.serialize()

def verifyJwt(token: str) -> Dict[str, Any]:
    """
    Verify and decode a JWT.
    
    Validates the token's signature and expiration time. If valid,
    returns the decoded claims.
    
    Args:
        token: The JWT string to verify
        
    Returns:
        Dict[str, Any]: The decoded claims if the token is valid
        
    Raises:
        Exception: If the token is invalid, expired, or has an invalid signature
        
    Example:
        >>> try:
        ...     claims = verifyJwt(token)
        ...     user_id = claims["sub"]
        ... except Exception as e:
        ...     print("Invalid token:", e)
    """
    try:
        # Verify signature and decode
        signed_token = jwt.JWT(jwt=token, key=SECRET_KEY)
        claims = signed_token.claims

        # Parse claims JSON
        return json.loads(claims)
    except Exception as e:
        raise Exception(f"Invalid or expired token: {str(e)}")
