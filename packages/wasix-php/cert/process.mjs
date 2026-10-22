/**
 * wasix-php processes: exec, shell_exec, system, passthru, popen and
 * proc_open (WASIX posix_spawn and pipes), pcntl_fork through asyncify
 * (proc_fork) with the child's exit status, pcntl_exec, pcntl signal
 * handlers (async and pcntl_signal_dispatch), pcntl_alarm and posix_kill.
 */
import { phpOk } from './lib/php.mjs';

export default async function (ctx) {
  const { assert } = ctx;

  assert.equal(await phpOk(ctx, `<?php
echo shell_exec("echo shell"), exec("printf 'a\\nb\\nlast'", $lines, $rc), "|", count($lines), "|", $rc, "\\n";
system("echo system; exit 3", $rc); echo "system rc=$rc\\n";
passthru("echo passthru"); echo shell_exec("echo shell2");
exec("exit 42", $o, $rc); echo "exit rc=$rc\\n";
$p = popen("tr a-z A-Z", "w"); fwrite($p, "popen write\\n"); $rc = pclose($p); echo "pclose=$rc\\n";
$p = popen("echo popen read", "r"); echo fgets($p); pclose($p);
`), 'shell\nlast|3|0\nsystem\nsystem rc=3\npassthru\nshell2\nexit rc=42\nPOPEN WRITE\npclose=0\npopen read\n');

  // proc_open: argv form (no shell), shell form, stdin/stdout/stderr pipes, env and cwd.
  assert.equal(await phpOk(ctx, `<?php
$p = proc_open(["cat"], [0 => ["pipe", "r"], 1 => ["pipe", "w"]], $pipes);
fwrite($pipes[0], "through cat\\n"); fclose($pipes[0]);
echo stream_get_contents($pipes[1]); fclose($pipes[1]); echo "cat=", proc_close($p), "\\n";
$p = proc_open("echo out; echo err >&2; exit 5", [1 => ["pipe", "w"], 2 => ["pipe", "w"]], $pipes, "/tmp", ["FOO" => "bar"]);
echo trim(stream_get_contents($pipes[1])), "|", trim(stream_get_contents($pipes[2])), "|";
$st = proc_get_status($p); echo $st["command"], "|"; echo proc_close($p), "\\n";
$p = proc_open(["sh", "-c", 'echo "$FOO $(pwd)"'], [1 => ["pipe", "w"]], $pipes, "/home", ["FOO" => "envvar", "PATH" => getenv("PATH")]);
echo stream_get_contents($pipes[1]); proc_close($p);
`), 'through cat\ncat=0\nout|err|echo out; echo err >&2; exit 5|5\nenvvar /home\n');

  // pcntl_fork: the child's own pid and exit status, both sides' output,
  // a pipe between them, and three children reaped with WNOHANG.
  assert.equal(await phpOk(ctx, `<?php
$parent = getmypid();
$pid = pcntl_fork();
if ($pid === 0) { echo "child ", getmypid() !== $parent ? "own pid" : "same pid", " ppid ", posix_getppid() === $parent ? "ok" : "?", "\\n"; exit(3); }
pcntl_waitpid($pid, $st);
echo "parent: exited ", var_export(pcntl_wifexited($st), true), " status ", pcntl_wexitstatus($st), "\\n";
[$r, $w] = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
$pid = pcntl_fork();
if ($pid === 0) { fclose($r); fwrite($w, "via socketpair " . (2 ** 10)); fclose($w); exit(0); }
fclose($w); echo stream_get_contents($r), "\\n"; pcntl_waitpid($pid, $st);
$kids = [];
for ($i = 1; $i <= 3; $i++) { $c = pcntl_fork(); if ($c === 0) { usleep(50000 * $i); exit(10 + $i); } $kids[$c] = true; }
$codes = [];
while ($kids) { $c = pcntl_waitpid(-1, $st, WNOHANG); if ($c > 0) { unset($kids[$c]); $codes[] = pcntl_wexitstatus($st); } else usleep(10000); }
sort($codes); echo implode(",", $codes), "\\n";
`), 'child own pid ppid ok\nparent: exited true status 3\nvia socketpair 1024\n11,12,13\n');

  // A forked child keeps the parent's variables, objects and open files.
  assert.equal(await phpOk(ctx, `<?php
$obj = new ArrayObject(["k" => "v"]); $big = str_repeat("x", 3 << 20);
$f = fopen("/tmp/php-fork-file", "w");
$pid = pcntl_fork();
if ($pid === 0) { fwrite($f, "child wrote " . $obj["k"] . " " . strlen($big) . "\\n"); exit(0); }
pcntl_waitpid($pid, $st); fclose($f);
echo file_get_contents("/tmp/php-fork-file");
`), 'child wrote v 3145728\n');

  // pcntl_exec replaces a forked child with another program.
  assert.equal(await phpOk(ctx, `<?php
$pid = pcntl_fork();
if ($pid === 0) { pcntl_exec("/bin/sh", ["-c", "echo execd; exit 9"]); exit(99); }
pcntl_waitpid($pid, $st); echo "status ", pcntl_wexitstatus($st), "\\n";
`), "execd\nstatus 9\n");

  // Signals: async handlers, dispatch, SIGALRM, SIGCHLD, a killed child, ignore.
  assert.equal(await phpOk(ctx, `<?php
pcntl_async_signals(true);
pcntl_signal(SIGUSR1, function ($s) { echo "USR1 $s\\n"; });
posix_kill(getmypid(), SIGUSR1); usleep(100000);
pcntl_signal(SIGALRM, function () { echo "ALRM\\n"; });
pcntl_alarm(1); $t = microtime(true); sleep(3); printf("sleep cut short: %s\\n", microtime(true) - $t < 2.5 ? "yes" : "no");
pcntl_async_signals(false);
pcntl_signal(SIGUSR2, function ($s) { echo "USR2 dispatched\\n"; });
posix_kill(getmypid(), SIGUSR2); usleep(50000); echo "before dispatch\\n"; pcntl_signal_dispatch();
pcntl_signal(SIGTERM, SIG_IGN); posix_kill(getmypid(), SIGTERM); usleep(50000); echo "TERM ignored\\n";
$pid = pcntl_fork();
if ($pid === 0) { sleep(30); exit(0); }
usleep(200000); posix_kill($pid, SIGKILL); pcntl_waitpid($pid, $st);
echo "child signaled ", var_export(pcntl_wifsignaled($st), true), " by ", pcntl_wtermsig($st), "\\n";
`), 'USR1 10\nALRM\nsleep cut short: yes\nbefore dispatch\nUSR2 dispatched\nTERM ignored\nchild signaled true by 9\n');

  // posix_* process and user information.
  const info = await phpOk(ctx, `<?php
echo posix_getuid(), "|", posix_geteuid(), "|", posix_getgid(), "|", posix_getpwuid(posix_getuid())["name"], "|", posix_getpwuid(0)["dir"], "|", posix_getgrgid(0)["name"], "|", posix_isatty(STDOUT) ? "tty" : "notty", "\\n";
`);
  assert.equal(info, '0|0|0|root|/root|root|notty\n');
}
