#!/usr/bin/env python3
"""Generate an RSA-OAEP key pair for API key encryption.

Install dependency first if needed:
  python3 -m pip install cryptography

The public key goes in the application environment as API_KEY_PUBLIC_KEY.
Keep the private key only in the receiving application that decrypts values.
"""

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def main() -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()

    print("# API_KEY_PUBLIC_KEY")
    print(public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode().strip())
    print("\n# Private key for receiving application only")
    print(private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode().strip())


if __name__ == "__main__":
    main()
