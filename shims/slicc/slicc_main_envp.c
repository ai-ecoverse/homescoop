/*
 * Emscripten calls main(argc, argv) only; a tool that reads its environment
 * from main's third argument (GNU make) would see none. Build the tool with
 * -Dmain=slicc_tool_main and link this real main, which passes environ.
 */
extern char **environ;
int slicc_tool_main(int argc, char **argv, char **envp);

int main(int argc, char **argv) {
  return slicc_tool_main(argc, argv, environ);
}
