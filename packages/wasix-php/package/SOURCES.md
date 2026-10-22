# Sources

bin/php.wasm is built from these sources, with `patches/` applied to PHP:

| source | sha256 |
| --- | --- |
| [php-8.5.12.tar.xz](https://www.php.net/distributions/php-8.5.12.tar.xz) | `08bc2eba2a588654ade1357174aa646b761556c862dda0678345ee29ed481209` |
| [libxml2-2.15.4.tar.xz](https://download.gnome.org/sources/libxml2/2.15/libxml2-2.15.4.tar.xz) | `98087fd181d9070724f3fbc65c7377db03038eb92bd882374daff44940138821` |
| [sqlite-amalgamation-3540000.zip](https://www.sqlite.org/2026/sqlite-amalgamation-3540000.zip) | `68e913b0fe8ec6b4e5f391c594a28872884e80d6cd042a1e50c957be46b5aa4d` |
| [@ai-ecoverse/wasix-zlib 1.3.1-3](https://registry.npmjs.org/@ai-ecoverse/wasix-zlib/-/wasix-zlib-1.3.1-3.tgz) | `f55d56c0837722e5d1e309f4344f723c95c7f68cd3ddb3089d6b4c025aaf14c7` |
| [@ai-ecoverse/wasix-openssl 3.5.9-4](https://registry.npmjs.org/@ai-ecoverse/wasix-openssl/-/wasix-openssl-3.5.9-4.tgz) | `47629bd4e1f53ee1aa32e3ef150cd744c4eb242632f8bad2818c631aa6c645b7` |

Build recipe: https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-php
