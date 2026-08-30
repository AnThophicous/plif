use std::process::{Command, Stdio};

pub fn install_exact(package: &str, version: &str, registry: &str) -> Result<(), String> {
    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let target = format!("{package}@{version}");
    let output = Command::new(npm)
        .args([
            "install",
            "--global",
            &target,
            "--registry",
            registry,
            "--loglevel",
            "error",
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("could not start npm: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if detail.is_empty() {
        format!("npm exited with {}", output.status)
    } else {
        detail
    })
}

pub fn global_root() -> Result<String, String> {
    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let output = Command::new(npm)
        .args(["root", "--global"])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("could not start npm: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("npm exited with {}", output.status)
        } else {
            detail
        });
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        Err("npm returned an empty global root".to_string())
    } else {
        Ok(root)
    }
}
