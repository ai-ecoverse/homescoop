static _Thread_local int side_tl = 40;

int side_add(int a, int b) { return a + b + side_tl - 40; }

int side_bump(void) { return ++side_tl; }
