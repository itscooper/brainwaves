"""Emoji validation utilities for the Brainwaves application.

This module provides functionality to validate emoji input for group icons
and other user-provided emoji content.
"""

import regex
from typing import Match, Optional

def is_single_emoji(emoji: str) -> bool:
    """
    Validate that a string contains exactly one emoji character.
    
    Uses the Unicode Emoji properties to accurately detect emoji characters,
    including combined emoji sequences (e.g. family emojis, flag emojis).
    
    Args:
        emoji: The string to validate
        
    Returns:
        bool: True if the string contains exactly one emoji, False otherwise
        
    Examples:
        >>> is_single_emoji("👍")
        True
        >>> is_single_emoji("👨‍👩‍👧‍👦")  # Family emoji (combined sequence)
        True
        >>> is_single_emoji("Hello")
        False
        >>> is_single_emoji("👍👎")  # Multiple emojis
        False
    """
    emoji_pattern = regex.compile(
        r"^\p{Emoji}+$",  # Match one or more Unicode emojis
        regex.UNICODE
    )
    return bool(emoji_pattern.fullmatch(emoji))