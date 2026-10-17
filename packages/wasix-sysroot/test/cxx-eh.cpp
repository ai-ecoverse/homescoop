#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#include <thread>
#include <exception>
#include <memory>
struct E : std::runtime_error { int v; E(int x) : std::runtime_error("e" + std::to_string(x)), v(x) {} };
struct D { int &n; ~D() { n++; } };
static thread_local std::string tl = "tls";
int f(int x) { if (x > 2) throw E(x); return x; }
int g(int &dtors) { D d{dtors}; D d2{dtors}; return f(9); }
int main() {
  int caught = 0, dtors = 0;
  for (int i = 0; i < 5; i++) { try { f(i); } catch (const E &e) { caught += e.v; } }
  try { std::vector<int> v; v.at(3); } catch (const std::out_of_range &) { caught += 100; }
  try { throw 7; } catch (int n) { caught += n * 1000; }
  try { g(dtors); } catch (const std::exception &e) { caught += (std::string(e.what()) == "e9") ? 10000 : 0; }
  std::exception_ptr ep;
  try { throw std::logic_error("saved"); } catch (...) { ep = std::current_exception(); }
  try { try { std::rethrow_exception(ep); } catch (const std::logic_error &) { throw; } } catch (const std::exception &e) { caught += 100000; }
  std::string seen;
  std::thread t([&] { tl = "thread"; try { throw std::runtime_error("in thread"); } catch (const std::exception &e) { seen = e.what(); } });
  t.join();
  std::cout << "caught=" << caught << " dtors=" << dtors << " tl=" << tl << " seen=" << seen << std::endl;
  return 0;
}
