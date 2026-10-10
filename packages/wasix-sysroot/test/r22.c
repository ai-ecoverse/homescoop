/* wasix-sysroot 2025.9.30-22: getitimer() now lives in setitimer.c (static
 * helper); it must still report the ITIMER_REAL setitimer() armed. */
#include <errno.h>
#include <stdio.h>
#include <sys/time.h>

int main(void)
{
	struct itimerval arm = {{0, 0}, {5, 0}}, old, now, off = {{0, 0}, {0, 0}};
	int s = setitimer(ITIMER_REAL, &arm, &old);
	int g = getitimer(ITIMER_REAL, &now);
	printf("armed: set=%d get=%d left=%lds interval=%lds\n", s, g, (long)now.it_value.tv_sec, (long)now.it_interval.tv_sec);
	errno = 0;
	int v = getitimer(ITIMER_VIRTUAL, &now);
	printf("virtual: %d %s\n", v, errno == EINVAL ? "EINVAL" : "other");
	setitimer(ITIMER_REAL, &off, &old);
	getitimer(ITIMER_REAL, &now);
	printf("disarmed: left=%ld old=%lds\n", (long)(now.it_value.tv_sec + now.it_value.tv_usec), (long)old.it_value.tv_sec);
	return 0;
}
