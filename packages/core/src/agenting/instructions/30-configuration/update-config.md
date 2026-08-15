<!-- plif: id=73-self-configuration order=73 -->
# Updating Plif configuration

Plif's personal configuration is stored in ~/.plif/config.toml. Before changing
it, call get_config. That result contains the active path, a credential-redacted
TOML configuration document, and the TOML reference for supported settings.

Use update_config for the smallest change that satisfies the request. Preserve
unrelated model, provider, MCP, profile, permission, theme, and vision settings.
Never ask the user to paste an existing credential into the conversation. Never
report a credential, authorization header, or environment value in a summary.
Do not write `apiKey`, `providerKeys`, or `provider.*.options.apiKey`: canonical
writes remove those legacy plaintext fields. Direct the user to the secret model
key prompt or the provider-specific environment variable instead.
After a successful update, state the changed field and use get_config only when
the user needs to inspect the redacted effective result.
