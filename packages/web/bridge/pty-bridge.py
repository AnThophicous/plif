#!/usr/bin/env python3
"""PTY bridge for the plif web adapter.

Allocates a real pseudo-terminal with the Python standard library (no native
Node addon, no compiler needed), spawns the requested command inside it, and
shuttles raw bytes between the PTY master and this process' stdin/stdout.

Channel layout (set up by the Node side):
  stdin  (fd 0)  -> bytes to write to the PTY master
  stdout (fd 1)  <- bytes read from the PTY master
  stderr (fd 2)  <- bridge diagnostics only
  fd 3           <- control channel; newline-delimited "resize <cols> <rows>"

The Node caller passes the command to run after a `--` separator.
"""
import argparse
import fcntl
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios

CONTROL_FD = 3


def set_winsize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    parser = argparse.ArgumentParser(prog="pty-bridge")
    parser.add_argument("--cols", type=int, default=80)
    parser.add_argument("--rows", type=int, default=24)
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("rest", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    command = args.rest
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        sys.stderr.write("pty-bridge: no command given\n")
        return 2

    master_fd, slave_fd = pty.openpty()
    try:
        set_winsize(slave_fd, args.rows, args.cols)
    except OSError:
        pass

    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"

    try:
        proc = subprocess.Popen(
            command,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            cwd=args.cwd,
            env=env,
            close_fds=True,
            start_new_session=True,
        )
    finally:
        os.close(slave_fd)

    stdin_fd = sys.stdin.fileno()
    stdout = sys.stdout.buffer
    os.set_blocking(master_fd, False)
    os.set_blocking(stdin_fd, False)
    try:
        os.set_blocking(CONTROL_FD, False)
        control_fd = CONTROL_FD
    except OSError:
        control_fd = None

    control_buf = b""
    stdout_closed = False

    def drain_master():
        try:
            data = os.read(master_fd, 65536)
        except OSError:
            return False
        if not data:
            return False
        stdout.write(data)
        stdout.flush()
        return True

    while True:
        watch = [master_fd, stdin_fd]
        if control_fd is not None:
            watch.append(control_fd)
        try:
            ready, _, _ = select.select(watch, [], [], 0.5)
        except InterruptedError:
            continue
        except OSError:
            break

        if master_fd in ready:
            if not drain_master():
                stdout_closed = True
                break

        if stdin_fd in ready:
            try:
                data = os.read(stdin_fd, 65536)
            except OSError:
                data = b""
            if not data:
                break
            try:
                os.write(master_fd, data)
            except OSError:
                break

        if control_fd is not None and control_fd in ready:
            try:
                data = os.read(control_fd, 4096)
            except OSError:
                data = b""
            if data:
                control_buf += data
                while b"\n" in control_buf:
                    line, control_buf = control_buf.split(b"\n", 1)
                    parts = line.decode("utf-8", "ignore").split()
                    if len(parts) == 3 and parts[0] == "resize":
                        try:
                            set_winsize(master_fd, int(parts[2]), int(parts[1]))
                            os.kill(proc.pid, signal.SIGWINCH)
                        except (ValueError, ProcessLookupError, OSError):
                            pass

        if proc.poll() is not None:
            # Drain whatever the child printed before exiting, then stop.
            drain_master()
            break

    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    return proc.returncode if proc.returncode is not None else 0


if __name__ == "__main__":
    sys.exit(main())
