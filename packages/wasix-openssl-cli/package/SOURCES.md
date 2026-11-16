# Sources

| source | sha256 |
| --- | --- |
| https://github.com/openssl/openssl/releases/download/openssl-3.5.9/openssl-3.5.9.tar.gz | `603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a` |
| https://curl.se/ca/cacert-2026-09-25.pem | `a41b5d356aea97a529fe27e0f7316d2f9d946d75927476cf9cf1b90637d00505` |

Toolchain: wasixcc with @ai-ecoverse/wasix-sysroot 2025.9.30-44. `patches/` are applied to the OpenSSL tree.

Build recipe: https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-openssl-cli
