const char banner[] = "homescoop-binutils-banner";
int counter = 42;
static int zeroed[4];
int greet(int x) { zeroed[x & 3] += x; return counter + x; }
