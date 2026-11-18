# `@ai-ecoverse/py-pyopenssl`

[pyOpenSSL](https://www.pyopenssl.org) 26.4.0 for slicc WASIX CPython: `OpenSSL.crypto` (X.509 certificates, keys, CSRs) and `OpenSSL.SSL` (TLS contexts and connections). azure-cli's certificate service-principal login reads its certificate with it.

```sh
python3 -c "import OpenSSL; print(OpenSSL.__version__, OpenSSL.SSL.OpenSSL_version(OpenSSL.SSL.OPENSSL_VERSION))"
```

- **Pure Python**, PyPI's wheel unchanged, in the version-neutral `lib/python3/site-packages`. It calls OpenSSL through `@ai-ecoverse/py-cryptography`'s cffi binding, so the OpenSSL it reports is the one py-cryptography links in (3.5.9).
- **Depends on** `@ai-ecoverse/py-cryptography` `>=50.0.2-1 <50.0.3` (pyOpenSSL 26.4.0 takes cryptography `>=49,<51`).
