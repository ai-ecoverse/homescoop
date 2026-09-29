/*
 * Emscripten musl has no getpass(3). Git's terminal.c needs a symbol; the
 * realm never prompts for a TTY password (proxy / CA handle auth).
 */
char *getpass(const char *prompt) {
  (void)prompt;
  static char empty[] = "";
  return empty;
}
