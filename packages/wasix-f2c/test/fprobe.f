C     wasix-f2c probe: a Fortran 77 program through bin/gfortran (f2c -R,
C     then wasixcc), linked with libf2c.a. It uses list-directed WRITE,
C     a SUBROUTINE with arrays, REAL and DOUBLE PRECISION functions, **,
C     CHARACTER concatenation and comparison, and INTEGER*4 loops.
      PROGRAM FPROBE
      INTEGER N, I, NBAD
      PARAMETER (N = 4)
      REAL X(N), Y(N), A, SNRM
      DOUBLE PRECISION D, DPOW
      CHARACTER*12 S
      EXTERNAL SAXPY, SNRM
      NBAD = 0
      A = 2.0
      DO 10 I = 1, N
         X(I) = REAL(I)
         Y(I) = 1.0
   10 CONTINUE
      CALL SAXPY(N, A, X, Y)
      WRITE (*, *) 'saxpy', (Y(I), I = 1, N)
      IF (Y(1) .NE. 3.0 .OR. Y(4) .NE. 9.0) NBAD = NBAD + 1
      WRITE (*, '(A, F8.4)') 'snrm ', SNRM(N, X)
      IF (ABS(SNRM(N, X) - SQRT(30.0)) .GT. 1.0E-5) NBAD = NBAD + 1
      D = DPOW(2.0D0, 10)
      WRITE (*, '(A, F8.1)') 'dpow ', D
      IF (D .NE. 1024.0D0) NBAD = NBAD + 1
      S = 'wasix' // '-' // 'f2c'
      WRITE (*, '(2A)') 'concat ', S
      IF (S .NE. 'wasix-f2c') NBAD = NBAD + 1
      IF (NBAD .EQ. 0) THEN
         WRITE (*, '(A)') 'fprobe ok'
      ELSE
         WRITE (*, '(A, I2)') 'fprobe FAIL ', NBAD
      END IF
      END

      SUBROUTINE SAXPY(N, A, X, Y)
      INTEGER N, I
      REAL A, X(N), Y(N)
      DO 20 I = 1, N
         Y(I) = Y(I) + A * X(I)
   20 CONTINUE
      END

      REAL FUNCTION SNRM(N, X)
      INTEGER N, I
      REAL X(N)
      SNRM = 0.0
      DO 30 I = 1, N
         SNRM = SNRM + X(I) * X(I)
   30 CONTINUE
      SNRM = SQRT(SNRM)
      END

      DOUBLE PRECISION FUNCTION DPOW(B, K)
      DOUBLE PRECISION B
      INTEGER K
      DPOW = B ** K
      END
