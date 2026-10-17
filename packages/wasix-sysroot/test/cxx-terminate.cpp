#include <cstdio>
#include <cstdlib>
#include <csignal>
#include <exception>
#include <stdexcept>
static void boom() noexcept { throw std::runtime_error("escapes a noexcept function"); }
int main() {
  std::set_terminate([] { std::puts("terminate handler ran"); std::fflush(stdout); std::raise(SIGKILL); });
  std::puts("throwing");
  std::fflush(stdout);
  boom();
  return 0;
}
