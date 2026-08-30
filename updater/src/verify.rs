use std::fs;
use std::path::Path;

pub fn version(value: &str) -> Result<(), String> {
    let core_and_build = value.split_once('+').map(|(left, _)| left).unwrap_or(value);
    let core = core_and_build
        .split_once('-')
        .map(|(left, _)| left)
        .unwrap_or(core_and_build);
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|part| part.is_empty() || part.parse::<u64>().is_err())
    {
        return Err(format!("invalid exact version {value}"));
    }
    if let Some((_, prerelease)) = core_and_build.split_once('-') {
        if prerelease.is_empty()
            || prerelease.split('.').any(|part| {
                part.is_empty()
                    || !part
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric() || character == '-')
            })
        {
            return Err(format!("invalid exact version {value}"));
        }
    }
    Ok(())
}

pub fn integrity(value: &str) -> Result<(), String> {
    let encoded = value.strip_prefix("sha512-").unwrap_or("");
    if encoded.len() < 16
        || !encoded.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '/' | '=')
        })
    {
        return Err("unsupported package integrity format".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{integrity, version};

    #[test]
    fn accepts_exact_release_versions() {
        assert!(version("0.4.0").is_ok());
        assert!(version("0.4.0-rc.1").is_ok());
        assert!(version("0.4.0+build.1").is_ok());
    }

    #[test]
    fn rejects_non_exact_versions() {
        assert!(version("latest").is_err());
        assert!(version("0.4").is_err());
        assert!(version("0.4.0-").is_err());
    }

    #[test]
    fn validates_npm_integrity_shape() {
        assert!(integrity("sha512-AAAAAAAAAAAAAAAA").is_ok());
        assert!(integrity("sha256-AAAAAAAAAAAAAAAA").is_err());
        assert!(integrity("sha512-!!!").is_err());
    }
}

pub fn installed_package(root: &str, package: &str, expected: &str) -> Result<(), String> {
    let path = package
        .split('/')
        .fold(Path::new(root).to_path_buf(), |path, part| path.join(part));
    let manifest = path.join("package.json");
    let body = fs::read_to_string(&manifest)
        .map_err(|error| format!("could not read {}: {error}", manifest.display()))?;
    let marker = format!("\"version\":\"{expected}\"");
    let spaced = format!("\"version\": \"{expected}\"");
    if body.contains(&marker) || body.contains(&spaced) {
        Ok(())
    } else {
        Err(format!(
            "{} does not report version {expected}",
            manifest.display()
        ))
    }
}
