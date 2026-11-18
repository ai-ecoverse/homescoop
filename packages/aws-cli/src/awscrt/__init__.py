"""homescoop (slicc): awscrt, the crypto API only, on pyca/cryptography.

This is not AWS's awscrt (the AWS Common Runtime, a native extension with no
WASIX build). It is the part of awscrt 0.38.1's Python API that the AWS CLI's
crypto commands call, awscrt.crypto and awscrt.exceptions, implemented on
cryptography (@ai-ecoverse/py-cryptography), which the AWS CLI v2 itself used
for them until 2024-2025 (aws/aws-cli "Use AWS CRT instead of cryptography").
So the CLI's own code runs unchanged:

  aws cloudfront sign                     RSA PKCS#1 v1.5 (SHA-1, SHA-256), ECDSA P-256
  aws ec2 get-password-data --priv-launch-key   RSA PKCS#1 v1.5 decryption
  aws cloudtrail validate-logs, verify-query-results   RSA PKCS#1 v1.5 SHA-256
  aws ec2-instance-connect ssh             Ed25519 keys in OpenSSH format
  aws login, and its credentials           EC P-256 keys, ES256 DPoP proofs

Everything else in awscrt (auth, http, io, s3, checksums, websocket) is
missing here, and botocore.compat.HAS_CRT is False (it checks
_HOMESCOOP_CRYPTO_ONLY below), so the code that would use it says
"Missing Dependency: … requires awscrt" instead.
"""

# botocore.compat reads this: awscrt is "there" for awscrt.crypto only.
_HOMESCOOP_CRYPTO_ONLY = True
