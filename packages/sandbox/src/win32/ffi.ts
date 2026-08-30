/**
 * Raw Win32 bindings for the sandbox backend.
 *
 * Loading is lazy and failure-tolerant on purpose: koffi is a native module,
 * and a machine without it should degrade to a weaker backend with a loud
 * report rather than crash the CLI at import time. Call `loadWin32()` and check
 * the result — never assume the bindings exist.
 */

export interface Win32Bindings {
  readonly kernel32: Kernel32;
  readonly koffi: Koffi;
}

export interface Win32CredentialBindings extends Win32Bindings {
  readonly advapi32: Record<string, unknown>;
}

export interface Koffi {
  alloc(type: unknown, count?: number): Buffer;
  // koffi's runtime surface we actually touch; kept narrow deliberately.
  [key: string]: unknown;
}

interface Kernel32 {
  CreateJobObjectW(attrs: null, name: string | null): unknown;
  SetInformationJobObject(job: unknown, infoClass: number, info: Buffer, len: number): number;
  QueryInformationJobObject(
    job: unknown,
    infoClass: number,
    info: Buffer,
    len: number,
    returned: null,
  ): number;
  AssignProcessToJobObject(job: unknown, process: unknown): number;
  TerminateJobObject(job: unknown, exitCode: number): number;
  OpenProcess(access: number, inherit: number, pid: number): unknown;
  CloseHandle(handle: unknown): number;
  GetLastError(): number;
  /** The OEM codepage — what console programs write to a pipe. */
  GetOEMCP(): number;
  MultiByteToWideChar(
    codePage: number,
    flags: number,
    input: Buffer,
    inputBytes: number,
    output: Buffer | null,
    outputChars: number,
  ): number;
}

// --- Job object information classes -----------------------------------------

export const JobObjectBasicAccountingInformation = 1;
export const JobObjectBasicUIRestrictions = 4;
export const JobObjectExtendedLimitInformation = 9;
export const JobObjectCpuRateControlInformation = 15;

// --- JOBOBJECT_BASIC_LIMIT_INFORMATION.LimitFlags ---------------------------

export const JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x0000_0008;
export const JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x0000_0100;
export const JOB_OBJECT_LIMIT_JOB_MEMORY = 0x0000_0200;
export const JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x0000_0400;
/**
 * The load-bearing flag. Ties the lifetime of every process in the job to the
 * job handle, so if the CLI is killed with SIGKILL the OS still reaps the whole
 * agent process tree. Without it, a crash leaks running sandboxed processes.
 */
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x0000_2000;

// --- JOBOBJECT_BASIC_UI_RESTRICTIONS ----------------------------------------

export const JOB_OBJECT_UILIMIT_HANDLES = 0x0000_0001;
export const JOB_OBJECT_UILIMIT_READCLIPBOARD = 0x0000_0002;
export const JOB_OBJECT_UILIMIT_WRITECLIPBOARD = 0x0000_0004;
export const JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS = 0x0000_0008;
export const JOB_OBJECT_UILIMIT_DISPLAYSETTINGS = 0x0000_0010;
export const JOB_OBJECT_UILIMIT_GLOBALATOMS = 0x0000_0020;
export const JOB_OBJECT_UILIMIT_DESKTOP = 0x0000_0040;
export const JOB_OBJECT_UILIMIT_EXITWINDOWS = 0x0000_0080;

/**
 * Everything. A sandboxed build step has no business reading the clipboard,
 * switching desktops, or calling ExitWindowsEx.
 */
export const UI_RESTRICTIONS_ALL =
  JOB_OBJECT_UILIMIT_HANDLES |
  JOB_OBJECT_UILIMIT_READCLIPBOARD |
  JOB_OBJECT_UILIMIT_WRITECLIPBOARD |
  JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS |
  JOB_OBJECT_UILIMIT_DISPLAYSETTINGS |
  JOB_OBJECT_UILIMIT_GLOBALATOMS |
  JOB_OBJECT_UILIMIT_DESKTOP |
  JOB_OBJECT_UILIMIT_EXITWINDOWS;

// --- CPU rate control --------------------------------------------------------

export const JOB_OBJECT_CPU_RATE_CONTROL_ENABLE = 0x0000_0001;
export const JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP = 0x0000_0004;

// --- Process access rights ---------------------------------------------------

export const PROCESS_TERMINATE = 0x0001;
export const PROCESS_SET_QUOTA = 0x0100;
export const PROCESS_QUERY_INFORMATION = 0x0400;

// --- Struct layouts (x64) ----------------------------------------------------
//
// Offsets are hand-computed for the x64 ABI and asserted by the sizes below.
// If Plif is ever built for arm64 Windows these stay valid (same LLP64 layout);
// for x86 they do not, which is why the backend refuses to load on ia32.

/** JOBOBJECT_BASIC_LIMIT_INFORMATION, 64 bytes on x64. */
export const BASIC_LIMIT_SIZE = 64;
export const OFF_LIMIT_FLAGS = 16;
export const OFF_MIN_WORKING_SET = 24;
export const OFF_MAX_WORKING_SET = 32;
export const OFF_ACTIVE_PROCESS_LIMIT = 40;
export const OFF_AFFINITY = 48;
export const OFF_PRIORITY_CLASS = 56;
export const OFF_SCHEDULING_CLASS = 60;

/** JOBOBJECT_EXTENDED_LIMIT_INFORMATION = basic(64) + IO_COUNTERS(48) + 4 SIZE_T. */
export const EXTENDED_LIMIT_SIZE = 144;
export const OFF_PROCESS_MEMORY_LIMIT = 112;
export const OFF_JOB_MEMORY_LIMIT = 120;
export const OFF_PEAK_PROCESS_MEMORY = 128;
export const OFF_PEAK_JOB_MEMORY = 136;

/** JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, 48 bytes on x64. */
export const ACCOUNTING_SIZE = 48;
export const OFF_TOTAL_USER_TIME = 0;
export const OFF_TOTAL_KERNEL_TIME = 8;
export const OFF_TOTAL_PROCESSES = 36;
export const OFF_ACTIVE_PROCESSES = 40;

let cached: Win32Bindings | null | undefined;
let loadError: string | undefined;
let credentialCached: Win32CredentialBindings | null | undefined;

/**
 * Returns the bindings, or null if this machine cannot provide them. The reason
 * is available from `win32LoadError()` and is surfaced verbatim in the sandbox
 * capability report so a degraded run is always explainable.
 */
export async function loadWin32(): Promise<Win32Bindings | null> {
  if (cached !== undefined) return cached;

  if (process.platform !== 'win32') {
    loadError = `platform is ${process.platform}, not win32`;
    cached = null;
    return null;
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    // The struct offsets above assume LLP64. Refuse rather than corrupt memory.
    loadError = `unsupported architecture ${process.arch}; expected x64 or arm64`;
    cached = null;
    return null;
  }

  try {
    const koffi = (await import('koffi')).default as unknown as Koffi;
    const lib = (koffi as unknown as { load(path: string): Record<string, unknown> }).load(
      'kernel32.dll',
    );
    const fn = (lib as unknown as { func(signature: string): unknown }).func.bind(lib);

    const kernel32 = {
      CreateJobObjectW: fn('void* __stdcall CreateJobObjectW(void*, const char16_t*)'),
      SetInformationJobObject: fn(
        'int __stdcall SetInformationJobObject(void*, int, void*, uint32_t)',
      ),
      QueryInformationJobObject: fn(
        'int __stdcall QueryInformationJobObject(void*, int, _Out_ void*, uint32_t, void*)',
      ),
      AssignProcessToJobObject: fn('int __stdcall AssignProcessToJobObject(void*, void*)'),
      TerminateJobObject: fn('int __stdcall TerminateJobObject(void*, uint32_t)'),
      OpenProcess: fn('void* __stdcall OpenProcess(uint32_t, int, uint32_t)'),
      CloseHandle: fn('int __stdcall CloseHandle(void*)'),
      GetLastError: fn('uint32_t __stdcall GetLastError()'),
      GetOEMCP: fn('uint32_t __stdcall GetOEMCP()'),
      // Declared with void* rather than const char* so koffi passes raw bytes
      // instead of treating the input as a NUL-terminated string — console
      // output is binary until it has been decoded.
      MultiByteToWideChar: fn(
        'int __stdcall MultiByteToWideChar(uint32_t, uint32_t, void*, int, _Out_ void*, int)',
      ),
    } as unknown as Kernel32;

    cached = { kernel32, koffi };
    return cached;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    cached = null;
    return null;
  }
}

export function win32LoadError(): string | undefined {
  return loadError;
}

export async function loadWindowsCredentialManager(): Promise<Win32CredentialBindings | null> {
  if (credentialCached !== undefined) return credentialCached;
  const base = await loadWin32();
  if (!base) {
    credentialCached = null;
    return null;
  }
  try {
    const library = (base.koffi as unknown as { load(path: string): Record<string, unknown> }).load(
      'advapi32.dll',
    );
    credentialCached = { ...base, advapi32: library };
    return credentialCached;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    credentialCached = null;
    return null;
  }
}

/** 100-nanosecond FILETIME ticks, as written into job accounting structs. */
export function ticksToMillis(ticks: bigint): number {
  return Number(ticks / 10_000n);
}
