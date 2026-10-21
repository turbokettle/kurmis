"""Runs a program on a new pseudo-terminal and sends it Ctrl-C or SIGTERM, for wrapper-pty.test.ts.

Usage: python3 -I pty-driver.py <action> <ready-text> <timeout-seconds> <program> [args...]

<program> runs as the leader of a new session, with the pseudo-terminal as its controlling
terminal, so it and everything it starts are the terminal's foreground process group, as in a
real terminal. Once <ready-text> has appeared in the terminal's output, the driver does <action>:

  ctrl-c    writes Ctrl-C to the terminal, which sends SIGINT to the whole foreground group
  sigterm   sends SIGTERM to <program> alone

It then waits for <program> to end and prints one JSON object on stdout:
{"exitCode", "signal", "sent", "leftover", "timedOut", "output"}. "signal" is the name of the
signal that ended <program>, or null. "leftover" is true when a process of the group was still
running after <program> ended. Any process still running at the end, or at the timeout, is
killed, so nothing is left behind.
"""

import json
import os
import pty
import select
import signal
import sys
import time


def group_alive(pgid):
    # macOS answers EPERM for a group whose only members are zombies waiting to be reaped, which
    # are not running. A running process of this user's would answer success.
    try:
        os.killpg(pgid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def kill_group(pgid):
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def main():
    action, ready, timeout = sys.argv[1], sys.argv[2], float(sys.argv[3])
    argv = sys.argv[4:]
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execv(argv[0], argv)
        finally:
            os._exit(127)

    output = b""
    sent = False
    status = None
    timed_out = False
    deadline = time.monotonic() + timeout
    while status is None:
        if time.monotonic() > deadline:
            timed_out = True
            break
        readable, _, _ = select.select([fd], [], [], 0.05)
        if readable:
            try:
                output += os.read(fd, 4096)
            except OSError:
                pass
        if not sent and ready.encode() in output:
            if action == "ctrl-c":
                os.write(fd, b"\x03")
            elif action == "sigterm":
                os.kill(pid, signal.SIGTERM)
            else:
                raise SystemExit("unknown action " + action)
            sent = True
        done, wait_status = os.waitpid(pid, os.WNOHANG)
        if done == pid:
            status = wait_status

    # The program led its own session, so its pid is the group id of everything it started. A
    # child that is ending as the program ends gets a second to finish.
    leftover = False
    if timed_out:
        kill_group(pid)
    else:
        for _ in range(50):
            leftover = group_alive(pid)
            if not leftover:
                break
            time.sleep(0.02)
        if leftover:
            kill_group(pid)
    if status is None:
        _, status = os.waitpid(pid, 0)
    for _ in range(100):
        if not group_alive(pid):
            break
        time.sleep(0.02)

    try:
        while select.select([fd], [], [], 0)[0]:
            chunk = os.read(fd, 4096)
            if not chunk:
                break
            output += chunk
    except OSError:
        pass
    os.close(fd)

    exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else None
    ended_by = signal.Signals(os.WTERMSIG(status)).name if os.WIFSIGNALED(status) else None
    print(json.dumps({
        "exitCode": exit_code,
        "signal": ended_by,
        "sent": sent,
        "leftover": leftover,
        "timedOut": timed_out,
        "output": output.decode("utf-8", "replace"),
    }))


main()
