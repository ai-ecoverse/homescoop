//! [`crate::tokio`] on WASI: a child is waited for with a non-blocking
//! `proc_join`, and its pipes are read and written once `poll_oneoff`
//! (with a zero timeout) finds them ready. Between tries the task sleeps on
//! tokio's timer, from 1 ms doubling to 32 ms while nothing happens, so
//! nothing blocks the runtime and no thread is started.
use std::ffi::OsStr;
use std::fs::File;
use std::future::Future;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, RawFd};
use std::path::Path;
use std::pin::Pin;
use std::task::{ready, Context, Poll};
use std::time::Duration;

use ::tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, ReadBuf};
use ::tokio::time::Sleep;

use super::{cvt, sys, Default3, ExitStatus, Output, Stdio};

const FIRST: Duration = Duration::from_millis(1);
const LAST: Duration = Duration::from_millis(32);

/// The timer between two polls.
#[derive(Debug)]
struct Backoff {
    delay: Duration,
    sleep: Option<Pin<Box<Sleep>>>,
}

impl Backoff {
    fn new() -> Self {
        Self {
            delay: FIRST,
            sleep: None,
        }
    }

    fn reset(&mut self) {
        self.delay = FIRST;
        self.sleep = None;
    }

    /// Ready when the next try is due; the delay after it is doubled.
    fn poll(&mut self, cx: &mut Context<'_>) -> Poll<()> {
        let delay = self.delay;
        let sleep = self
            .sleep
            .get_or_insert_with(|| Box::pin(::tokio::time::sleep(delay)));
        ready!(sleep.as_mut().poll(cx));
        self.sleep = None;
        self.delay = (self.delay * 2).min(LAST);
        Poll::Ready(())
    }

    async fn tick(&mut self) {
        std::future::poll_fn(|cx| self.poll(cx)).await;
    }
}

const SUB_SIZE: usize = 48;
const EVENT_SIZE: usize = 32;
const EVENTTYPE_CLOCK: u8 = 0;
const EVENTTYPE_FD_READ: u8 = 1;
const EVENTTYPE_FD_WRITE: u8 = 2;
const CLOCK_MONOTONIC: u32 = 1;

/// Whether `fd` can be read (or written) without blocking: also true at EOF
/// and on an error, which the read or write then reports.
fn is_ready(fd: RawFd, kind: u8) -> io::Result<bool> {
    let mut subs = [0u8; SUB_SIZE * 2];
    subs[0..8].copy_from_slice(&1u64.to_le_bytes());
    subs[8] = kind;
    subs[16..20].copy_from_slice(&(fd as u32).to_le_bytes());
    let clock = &mut subs[SUB_SIZE..];
    clock[8] = EVENTTYPE_CLOCK;
    clock[16..20].copy_from_slice(&CLOCK_MONOTONIC.to_le_bytes());
    // timeout 0 (relative), precision 0, flags 0
    let mut events = [0u8; EVENT_SIZE * 2];
    let mut got = 0u32;
    cvt(unsafe { sys::poll_oneoff(subs.as_ptr(), events.as_mut_ptr(), 2, &mut got) })?;
    Ok(events
        .chunks_exact(EVENT_SIZE)
        .take(got as usize)
        .any(|event| event[0..8] == 1u64.to_le_bytes()))
}

/// A builder for a child process, like `tokio::process::Command`.
#[derive(Debug)]
pub struct Command {
    std: super::Command,
    kill_on_drop: bool,
}

impl From<super::Command> for Command {
    fn from(std: super::Command) -> Command {
        Command {
            std,
            kill_on_drop: false,
        }
    }
}

impl Command {
    pub fn new<S: AsRef<OsStr>>(program: S) -> Command {
        super::Command::new(program).into()
    }

    pub fn as_std(&self) -> &super::Command {
        &self.std
    }

    pub fn as_std_mut(&mut self) -> &mut super::Command {
        &mut self.std
    }

    pub fn arg<S: AsRef<OsStr>>(&mut self, arg: S) -> &mut Command {
        self.std.arg(arg);
        self
    }

    pub fn args<I, S>(&mut self, args: I) -> &mut Command
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.std.args(args);
        self
    }

    pub fn env<K: AsRef<OsStr>, V: AsRef<OsStr>>(&mut self, key: K, val: V) -> &mut Command {
        self.std.env(key, val);
        self
    }

    pub fn envs<I, K, V>(&mut self, vars: I) -> &mut Command
    where
        I: IntoIterator<Item = (K, V)>,
        K: AsRef<OsStr>,
        V: AsRef<OsStr>,
    {
        self.std.envs(vars);
        self
    }

    pub fn env_remove<K: AsRef<OsStr>>(&mut self, key: K) -> &mut Command {
        self.std.env_remove(key);
        self
    }

    pub fn env_clear(&mut self) -> &mut Command {
        self.std.env_clear();
        self
    }

    pub fn current_dir<P: AsRef<Path>>(&mut self, dir: P) -> &mut Command {
        self.std.current_dir(dir);
        self
    }

    pub fn stdin<T: Into<Stdio>>(&mut self, cfg: T) -> &mut Command {
        self.std.stdin(cfg);
        self
    }

    pub fn stdout<T: Into<Stdio>>(&mut self, cfg: T) -> &mut Command {
        self.std.stdout(cfg);
        self
    }

    pub fn stderr<T: Into<Stdio>>(&mut self, cfg: T) -> &mut Command {
        self.std.stderr(cfg);
        self
    }

    /// Sends SIGKILL to the child when its [`Child`] is dropped.
    pub fn kill_on_drop(&mut self, kill_on_drop: bool) -> &mut Command {
        self.kill_on_drop = kill_on_drop;
        self
    }

    pub fn get_program(&self) -> &OsStr {
        self.std.get_program()
    }

    pub fn get_args(&self) -> impl ExactSizeIterator<Item = &OsStr> {
        self.std.get_args()
    }

    pub fn get_envs(&self) -> impl ExactSizeIterator<Item = (&OsStr, Option<&OsStr>)> {
        self.std.get_envs()
    }

    pub fn get_current_dir(&self) -> Option<&Path> {
        self.std.get_current_dir()
    }

    /// Starts the child with stdin, stdout and stderr inherited unless set.
    pub fn spawn(&mut self) -> io::Result<Child> {
        self.spawn_with(Default3::Inherit)
    }

    /// Runs the child to the end with stdin inherited unless set.
    pub async fn status(&mut self) -> io::Result<ExitStatus> {
        self.spawn()?.wait().await
    }

    /// Runs the child to the end and collects its stdout and stderr; stdin
    /// is null unless set.
    pub async fn output(&mut self) -> io::Result<Output> {
        self.spawn_with(Default3::Capture)?.wait_with_output().await
    }

    fn spawn_with(&mut self, default: Default3) -> io::Result<Child> {
        let mut inner = self.std.spawn_with(default)?;
        Ok(Child {
            stdin: inner.stdin.take().map(|end| ChildStdin::new(end.file)),
            stdout: inner.stdout.take().map(|end| ChildStdout(Pipe::new(end.file))),
            stderr: inner.stderr.take().map(|end| ChildStderr(Pipe::new(end.file))),
            inner,
            kill_on_drop: self.kill_on_drop,
        })
    }
}

/// A child process, like `tokio::process::Child`.
#[derive(Debug)]
pub struct Child {
    inner: super::Child,
    kill_on_drop: bool,
    pub stdin: Option<ChildStdin>,
    pub stdout: Option<ChildStdout>,
    pub stderr: Option<ChildStderr>,
}

impl Child {
    /// The pid, until the child has been waited for.
    pub fn id(&self) -> Option<u32> {
        self.inner.status.is_none().then_some(self.inner.pid)
    }

    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.inner.try_wait()
    }

    /// Waits for the child to exit, closing its stdin first.
    pub async fn wait(&mut self) -> io::Result<ExitStatus> {
        drop(self.stdin.take());
        let mut backoff = Backoff::new();
        loop {
            if let Some(status) = self.inner.try_wait()? {
                return Ok(status);
            }
            backoff.tick().await;
        }
    }

    /// Sends SIGKILL without waiting.
    pub fn start_kill(&mut self) -> io::Result<()> {
        self.inner.kill()
    }

    /// Sends SIGKILL and waits for the child.
    pub async fn kill(&mut self) -> io::Result<()> {
        self.start_kill()?;
        self.wait().await?;
        Ok(())
    }

    /// Closes stdin, collects stdout and stderr (both at once), then waits.
    pub async fn wait_with_output(mut self) -> io::Result<Output> {
        drop(self.stdin.take());
        async fn read_all<R: AsyncRead + Unpin>(end: Option<R>) -> io::Result<Vec<u8>> {
            let mut buf = Vec::new();
            if let Some(mut end) = end {
                end.read_to_end(&mut buf).await?;
            }
            Ok(buf)
        }
        let (stdout, stderr) = ::tokio::join!(
            read_all(self.stdout.take()),
            read_all(self.stderr.take())
        );
        let status = self.wait().await?;
        Ok(Output {
            status,
            stdout: stdout?,
            stderr: stderr?,
        })
    }
}

impl Drop for Child {
    fn drop(&mut self) {
        if self.kill_on_drop {
            let _ = self.inner.kill();
        }
    }
}

/// The parent's end of a pipe.
#[derive(Debug)]
struct Pipe {
    file: Option<File>,
    backoff: Backoff,
}

impl Pipe {
    fn new(file: File) -> Self {
        Self {
            file: Some(file),
            backoff: Backoff::new(),
        }
    }

    fn poll_ready(&mut self, cx: &mut Context<'_>, kind: u8) -> Poll<io::Result<&mut File>> {
        let Some(file) = self.file.as_mut() else {
            return Poll::Ready(Err(io::ErrorKind::BrokenPipe.into()));
        };
        loop {
            if is_ready(file.as_raw_fd(), kind)? {
                self.backoff.reset();
                return Poll::Ready(Ok(file));
            }
            ready!(self.backoff.poll(cx));
        }
    }

    fn poll_read(&mut self, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        let file = ready!(self.poll_ready(cx, EVENTTYPE_FD_READ))?;
        let n = file.read(buf.initialize_unfilled())?;
        buf.advance(n);
        Poll::Ready(Ok(()))
    }
}

impl AsRawFd for Pipe {
    fn as_raw_fd(&self) -> RawFd {
        self.file.as_ref().map_or(-1, AsRawFd::as_raw_fd)
    }
}

/// The child's stdin, like `tokio::process::ChildStdin`.
#[derive(Debug)]
pub struct ChildStdin(Pipe);

impl ChildStdin {
    fn new(file: File) -> Self {
        Self(Pipe::new(file))
    }
}

/// The child's stdout, like `tokio::process::ChildStdout`.
#[derive(Debug)]
pub struct ChildStdout(Pipe);

/// The child's stderr, like `tokio::process::ChildStderr`.
#[derive(Debug)]
pub struct ChildStderr(Pipe);

impl AsyncWrite for ChildStdin {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let file = ready!(self.get_mut().0.poll_ready(cx, EVENTTYPE_FD_WRITE))?;
        Poll::Ready(file.write(buf))
    }

    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    /// Closes the pipe, so the child reads EOF.
    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        drop(self.get_mut().0.file.take());
        Poll::Ready(Ok(()))
    }
}

impl AsyncRead for ChildStdout {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.get_mut().0.poll_read(cx, buf)
    }
}

impl AsyncRead for ChildStderr {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.get_mut().0.poll_read(cx, buf)
    }
}

macro_rules! raw_fd {
    ($($name:ident),*) => {$(
        impl AsRawFd for $name {
            fn as_raw_fd(&self) -> RawFd {
                self.0.as_raw_fd()
            }
        }
    )*};
}
raw_fd!(ChildStdin, ChildStdout, ChildStderr);
