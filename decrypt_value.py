#!/usr/bin/env python3
"""Decrypt an encrypted API key value with the private RSA key.

Examples:
  python3 decrypt_value.py --private-key private_key.pem --value '<base64-encrypted-value>'
  API_KEY_PRIVATE_KEY="$(cat private_key.pem)" python3 decrypt_value.py --value '<base64-encrypted-value>'

Install dependency first if needed:
  python3 -m pip install cryptography
"""

import argparse
import base64
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Decrypt a base64 RSA-OAEP/SHA-256 value returned by the API key service.",
    )
    parser.add_argument(
        "--value",
        required=True,
        help="Base64 encrypted value returned in the API response or Telegram message.",
    )
    parser.add_argument(
        "--private-key",
        help="Path to the PEM private key. If omitted, API_KEY_PRIVATE_KEY is used.",
    )
    return parser.parse_args()


def load_private_key_pem(private_key_path: str | None) -> bytes:
    if private_key_path:
        return Path(private_key_path).read_bytes()

    private_key = os.environ.get("API_KEY_PRIVATE_KEY")
    if private_key:
        return private_key.encode()

    sys.exit("Provide --private-key or set API_KEY_PRIVATE_KEY with the PEM private key.")


def decrypt_value(private_key_pem: bytes, encrypted_value: str) -> str:
    private_key = serialization.load_pem_private_key(private_key_pem, password=None)
    plaintext = private_key.decrypt(
        base64.b64decode(encrypted_value),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return plaintext.decode()


def main() -> None:
    args = parse_args()
    private_key_pem = load_private_key_pem(args.private_key)
    print(decrypt_value(private_key_pem, args.value))


if __name__ == "__main__":
    main()
