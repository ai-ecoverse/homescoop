/* wasix-openblas probe: BLAS (Fortran and CBLAS), LAPACK and a program's own
 * xerbla_ overriding OpenBLAS's weak one, with the f2c int ABI the package's
 * headers declare. Linked with -Wl,--fatal-warnings, so a void/int
 * signature mismatch (a trapping stub) fails the link. */
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <cblas.h>

typedef int blasint_t;
extern int dgemm_(const char *, const char *, const blasint_t *, const blasint_t *, const blasint_t *,
                  const double *, const double *, const blasint_t *, const double *, const blasint_t *,
                  const double *, double *, const blasint_t *);
extern double ddot_(const blasint_t *, const double *, const blasint_t *, const double *, const blasint_t *);
extern int dgesv_(const blasint_t *, const blasint_t *, double *, const blasint_t *, blasint_t *, double *,
                  const blasint_t *, blasint_t *);
extern int dsyev_(const char *, const char *, const blasint_t *, double *, const blasint_t *, double *,
                  double *, const blasint_t *, blasint_t *);
extern int dsyevd_(const char *, const char *, const blasint_t *, double *, const blasint_t *, double *,
                   double *, const blasint_t *, blasint_t *, const blasint_t *, blasint_t *);

/* dsyevd_ with eigenvectors on n > SMLSIZ (25): divide and conquer, through
 * dstedc, dlaed0..dlaed3 (OpenBLAS's own lapack/laed3 since 0.3.34, #1173)
 * and dlaed4_. tridiag(-1, 2, -1) has eigenvalues 2 - 2cos(k pi/(n+1)). */
#define EN 64
static double EA[EN * EN], EA0[EN * EN], EW[EN], EWORK[1 + 6 * EN + 2 * EN * EN];
static blasint_t EIWORK[3 + 5 * EN];

static char xname[8];
static int xinfo = -1;
/* The program's own xerbla_ (2-argument, as numpy's python_xerbla). */
int xerbla_(char *name, blasint_t *info) {
  memcpy(xname, name, 6);
  xname[6] = 0;
  xinfo = *info;
  return 0;
}

int main(void) {
  int bad = 0;
  /* C = A(2x3) * B(3x2), column-major */
  double A[6] = {1, 4, 2, 5, 3, 6}, B[6] = {7, 9, 11, 8, 10, 12}, C[4] = {0};
  blasint_t m = 2, n = 2, k = 3, lda = 2, ldb = 3, ldc = 2;
  double one = 1, zero = 0;
  dgemm_("N", "N", &m, &n, &k, &one, A, &lda, B, &ldb, &zero, C, &ldc);
  printf("dgemm_ %g %g %g %g\n", C[0], C[1], C[2], C[3]);
  bad |= !(C[0] == 58 && C[1] == 139 && C[2] == 64 && C[3] == 154);

  double D[4] = {0};
  cblas_dgemm(CblasRowMajor, CblasNoTrans, CblasNoTrans, 2, 2, 3, 1.0,
              (double[]){1, 2, 3, 4, 5, 6}, 3, (double[]){7, 8, 9, 10, 11, 12}, 2, 0.0, D, 2);
  printf("cblas_dgemm %g %g %g %g\n", D[0], D[1], D[2], D[3]);
  bad |= !(D[0] == 58 && D[1] == 64 && D[2] == 139 && D[3] == 154);

  blasint_t three = 3, inc = 1;
  double x[3] = {1, 2, 3}, y[3] = {4, 5, 6};
  double dot = ddot_(&three, x, &inc, y, &inc);
  printf("ddot_ %g\n", dot);
  bad |= dot != 32;

  /* Solve [[2,1],[1,3]] x = [3,5] -> x = [0.8, 1.4] */
  double M[4] = {2, 1, 1, 3}, rhs[2] = {3, 5};
  blasint_t two = 2, nrhs = 1, ipiv[2], info = -1;
  dgesv_(&two, &nrhs, M, &two, ipiv, rhs, &two, &info);
  printf("dgesv_ info=%d x=%.6f %.6f\n", info, rhs[0], rhs[1]);
  bad |= info != 0 || fabs(rhs[0] - 0.8) > 1e-12 || fabs(rhs[1] - 1.4) > 1e-12;

  /* Eigenvalues of [[2,1],[1,2]]: 1, 3 */
  double S[4] = {2, 1, 1, 2}, w[2], work[64];
  blasint_t lwork = 64;
  info = -1;
  dsyev_("N", "U", &two, S, &two, w, work, &lwork, &info);
  printf("dsyev_ info=%d w=%.6f %.6f\n", info, w[0], w[1]);
  bad |= info != 0 || fabs(w[0] - 1) > 1e-12 || fabs(w[1] - 3) > 1e-12;

  {
    blasint_t en = EN, lw = sizeof EWORK / sizeof *EWORK, liw = sizeof EIWORK / sizeof *EIWORK;
    for (int j = 0; j < EN; j++)
      for (int i = 0; i < EN; i++) EA[i + j * EN] = i == j ? 2 : (i - j == 1 || j - i == 1) ? -1 : 0;
    memcpy(EA0, EA, sizeof EA);
    info = -1;
    dsyevd_("V", "U", &en, EA, &en, EW, EWORK, &lw, EIWORK, &liw, &info);
    double ew = 0, er = 0;
    for (int k = 0; k < EN; k++) {
      double e = fabs(EW[k] - (2 - 2 * cos((k + 1) * M_PI / (EN + 1))));
      if (e > ew) ew = e;
      for (int i = 0; i < EN; i++) { /* (A0 v_k - w_k v_k)_i */
        double s = -EW[k] * EA[i + k * EN];
        for (int j = 0; j < EN; j++) s += EA0[i + j * EN] * EA[j + k * EN];
        if (fabs(s) > er) er = fabs(s);
      }
    }
    printf("dsyevd_ n=%d info=%d %s\n", EN, info, info == 0 && ew < 1e-12 && er < 1e-12 ? "ok" : "BAD");
    printf("dsyevd_ maxerr w=%.3g Av-wv=%.3g\n", ew, er);
    bad |= info != 0 || ew >= 1e-12 || er >= 1e-12;
  }

  /* An illegal TRANSA: OpenBLAS calls xerbla_, which is ours. */
  dgemm_("X", "N", &m, &n, &k, &one, A, &lda, B, &ldb, &zero, C, &ldc);
  printf("xerbla_ %s %d\n", xname, xinfo);
  bad |= strncmp(xname, "DGEMM", 5) != 0 || xinfo != 1;

  printf("config %s\n", openblas_get_config());
  printf("%s\n", bad ? "obprobe FAIL" : "obprobe ok");
  return bad;
}
