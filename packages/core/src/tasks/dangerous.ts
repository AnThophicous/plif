import path from 'node:path';

export function classifyDangerousCommand(argv: readonly string[]): string | null {
  const line = argv.join(' ');
  if (/(?:^|\s)(?:rm|rmdir|rd)\s+(?:[^\r\n]*\s+)?-[^\r\n]*r[^\r\n]*f/i.test(line)) {
    return 'recursive force deletion is blocked';
  }
  if (/(?:^|\s)(?:del|erase)\s+(?:[^\r\n]*\s+)?\/(?:s|q)(?:\s|$)/i.test(line)) {
    return 'recursive Windows deletion is blocked';
  }
  if (/(?:remove-item|remove_directory|shred)\b[^\r\n]*(?:-recurse|--recursive|\/s)\b/i.test(line)) {
    return 'recursive destructive operations are blocked';
  }
  if (/(?:disable|stop|delete|remove).*(?:defender|firewall|antivirus|security)/i.test(line)) {
    return 'security control changes are blocked';
  }
  if (/(?:^|[\\/:])(?:windows[\\/])?(?:system32|syswow64)(?:[\\/]|$)/i.test(line)) {
    return 'access to Windows administrative directories is blocked';
  }

  const command = path.basename(argv[0] ?? '').replace(/\.(?:exe|cmd|bat|com|ps1)$/i, '').toLowerCase();
  const blocked = new Map([
    ['bcdedit', 'boot configuration changes are blocked'],
    ['diskpart', 'raw disk operations are blocked'],
    ['format', 'raw disk formatting is blocked'],
    ['reg', 'registry changes are blocked'],
    ['regedit', 'registry changes are blocked'],
    ['netsh', 'host network changes are blocked'],
    ['sc', 'Windows service changes are blocked'],
    ['schtasks', 'external persistence is blocked'],
    ['takeown', 'host ownership changes are blocked'],
    ['icacls', 'host ACL changes are blocked'],
    ['cacls', 'host ACL changes are blocked'],
    ['shutdown', 'host shutdown is blocked'],
    ['runas', 'privilege elevation is blocked'],
    ['sudo', 'privilege elevation is blocked'],
    ['su', 'privilege elevation is blocked'],
  ]);
  return blocked.get(command) ?? null;
}
