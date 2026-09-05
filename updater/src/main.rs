mod install;
mod npm;
mod verify;

use std::env;
use std::process;
use std::thread;
use std::time::Duration;

#[derive(Default)]
struct Args {
    package: String,
    version: String,
    registry: String,
    install_root: Option<String>,
    parent_pid: Option<u32>,
    relaunch: Option<String>,
    relaunch_args: Vec<String>,
    integrity: Option<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut result = Args {
        package: "@plif/cli".to_string(),
        registry: "https://registry.npmjs.org".to_string(),
        ..Args::default()
    };
    let values: Vec<String> = env::args().skip(1).collect();
    let mut index = 0;
    while index < values.len() {
        let key = values[index].as_str();
        let value = |index: &mut usize| -> Result<String, String> {
            *index += 1;
            values
                .get(*index)
                .cloned()
                .ok_or_else(|| format!("missing value for {key}"))
        };
        match key {
            "--package" => result.package = value(&mut index)?,
            "--version" => result.version = value(&mut index)?,
            "--registry" => result.registry = value(&mut index)?,
            "--install-root" => result.install_root = Some(value(&mut index)?),
            "--parent-pid" => {
                result.parent_pid = Some(
                    value(&mut index)?
                        .parse()
                        .map_err(|_| "invalid parent pid".to_string())?,
                )
            }
            "--relaunch" => result.relaunch = Some(value(&mut index)?),
            "--relaunch-arg" => result.relaunch_args.push(value(&mut index)?),
            "--integrity" => result.integrity = Some(value(&mut index)?),
            "--help" => return Err(usage()),
            other => return Err(format!("unknown argument {other}")),
        }
        index += 1;
    }
    if result.package != "@plif/cli" {
        return Err("only @plif/cli is supported".to_string());
    }
    verify::version(&result.version)?;
    let registry_authority = result
        .registry
        .strip_prefix("https://")
        .and_then(|rest| rest.split(|character| matches!(character, '/' | '?' | '#')).next())
        .unwrap_or("");
    if result.registry.is_empty()
        || !result.registry.starts_with("https://")
        || result.registry.chars().any(char::is_whitespace)
        || registry_authority.is_empty()
        || registry_authority.contains('@')
        || registry_authority.contains(':')
    {
        return Err("registry must be an https URL".to_string());
    }
    let integrity = result.integrity.as_ref().ok_or_else(|| "package integrity is required".to_string())?;
    verify::integrity(integrity)?;
    if result.relaunch.is_none() && result.install_root.is_none() {
        return Err("relaunch or install root is required".to_string());
    }
    Ok(result)
}

fn usage() -> String {
    "usage: plif-updater --package @plif/cli --version X.Y.Z --registry HTTPS_URL --integrity sha512-... --relaunch COMMAND [--relaunch-arg ARG]...".to_string()
}

fn main() {
    let args = match parse_args() {
        Ok(args) => args,
        Err(error) => {
            eprintln!("plif-updater: {error}");
            process::exit(2);
        }
    };
    if let Some(pid) = args.parent_pid {
        thread::sleep(Duration::from_millis(500));
        install::wait_for_parent(pid, Duration::from_secs(30));
    }
    if let Err(error) = npm::install_exact(
        &args.package,
        &args.version,
        &args.registry,
        args.integrity.as_deref().expect("integrity validated during argument parsing"),
    ) {
        eprintln!("plif-updater: update failed: {error}");
        process::exit(1);
    }
    let install_root = match args
        .install_root
        .clone()
        .map(Ok)
        .unwrap_or_else(npm::global_root)
    {
        Ok(root) => root,
        Err(error) => {
            eprintln!("plif-updater: could not resolve the global npm root: {error}");
            process::exit(1);
        }
    };
    if let Err(error) = verify::installed_package(&install_root, &args.package, &args.version) {
        eprintln!("plif-updater: installed package verification failed: {error}");
        process::exit(1);
    }
    if let Some(command) = args.relaunch.as_deref() {
        if let Err(error) = install::relaunch(command, &args.relaunch_args) {
            eprintln!("plif-updater: relaunch failed: {error}");
            process::exit(1);
        }
    }
}
