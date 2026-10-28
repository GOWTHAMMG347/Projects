from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def create_media_token(video_id: int, user_id: int, minutes: int = 60) -> str:
    """Short-lived token scoped to one video, so <video src> / <img src> can load it without an Authorization header."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return jwt.encode(
        {"sub": str(user_id), "vid": video_id, "typ": "media", "exp": expire}, SECRET_KEY, algorithm=ALGORITHM
    )


def decode_media_token(token: str) -> tuple[int, int] | None:
    """Returns (video_id, user_id) or None."""
    try:
        p = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if p.get("typ") != "media":
            return None
        return int(p["vid"]), int(p["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
