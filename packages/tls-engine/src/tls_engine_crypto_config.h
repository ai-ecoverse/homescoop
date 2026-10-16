/*
 * tls_engine_crypto_config.h — TF-PSA-Crypto user configuration of the SLICC
 * TLS engine (TF_PSA_CRYPTO_USER_CONFIG_FILE, read after the default
 * <psa/crypto_config.h>, by the library build and the engine alike).
 *
 * A page or worker has no OS entropy source, so the built-in ones go and the
 * engine's own mbedtls_platform_get_entropy (crypto.getRandomValues) seeds
 * PSA's DRBG. Mbed TLS 3.6 spelled this MBEDTLS_NO_PLATFORM_ENTROPY plus
 * MBEDTLS_ENTROPY_HARDWARE_ALT (mbedtls_hardware_poll).
 */
#undef MBEDTLS_PSA_BUILTIN_GET_ENTROPY
#define MBEDTLS_PSA_DRIVER_GET_ENTROPY
