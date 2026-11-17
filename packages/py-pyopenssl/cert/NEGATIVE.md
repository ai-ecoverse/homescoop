# py-pyopenssl: negative proof

## 26.4.0-1: the first build (2026-11-17)

pyOpenSSL is pure Python; everything it does goes through
`cryptography.hazmat.bindings.openssl.binding.Binding`, py-cryptography's cffi
`_openssl` module. Without `@ai-ecoverse/py-cryptography` (the same tarball
installed with wasix-python 3.15.0-8 only), every spec fails at the import:

```
$ python3 -c 'import OpenSSL'
  File "/node_modules/@ai-ecoverse/py-pyopenssl/lib/python3/site-packages/OpenSSL/SSL.py", …
    from cryptography import x509
ModuleNotFoundError: No module named 'cryptography'
rc 1
```

## Specs non-vacuous

`pyopenssl.mjs` needs the thumbprint to equal an independently computed
SHA-1 of the certificate's DER, an empty store to refuse the leaf, the
handshake to reach TLS 1.3 with the server's CN as the verified peer, and the
bytes sent by the client to arrive at the server; `record.mjs` flips a byte
in a copy and must see the RECORD mismatch.
