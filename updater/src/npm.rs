use std::process::{Command, Stdio};

pub fn install_exact(package: &str, version: &str, registry: &str, expected_integrity: &str) -> Result<(), String> {
    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let target = format!("{package}@{version}");
    let metadata = Command::new(npm)
        .args([
            "view",
            &target,
            "dist.integrity",
            "--json",
            "--registry",
            registry,
            "--loglevel",
            "error",
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("could not start npm for integrity verification: {error}"))?;
    if !metadata.status.success() {
        let detail = String::from_utf8_lossy(&metadata.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("npm integrity lookup exited with {}", metadata.status)
        } else {
            format!("could not verify package integrity: {detail}")
        });
    }
    let actual = String::from_utf8_lossy(&metadata.stdout).trim().trim_matches('"').to_string();
    if actual != expected_integrity {
        return Err(format!(
            "registry integrity changed for {target}: expected {expected_integrity}, got {actual}"
        ));
    }
    let output = Command::new(npm)
        .args([
            "install",
            "--global",
            &target,
            "--registry",
            registry,
            "--loglevel",
            "error",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
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
