use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub fn wait_for_parent(pid: u32, timeout: Duration) {
    let started = Instant::now();
    while started.elapsed() < timeout && process_exists(pid) {
        thread::sleep(Duration::from_millis(250));
    }
}

fn process_exists(pid: u32) -> bool {
    if cfg!(windows) {
        return Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .map(|output| {
                output.status.success()
                    && String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
            })
            .unwrap_or(false);
    }
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn relaunch(command: &str, args: &[String]) -> Result<(), String> {
    Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not start {command}: {error}"))
}
