# Integration #7/#39: native test-launch failure

Status: unchanged-case focused check passed; the same full required integration selection subsequently passed naturally as root handle `23328` (six suites/25 tests, 109.895 seconds, exit 0). Original native-launch failure remains preserved.

Root's first integration handle `38912` passed forced compilation/admin static checks and 24 of 25 tests. The failed case was the expired-session recovery browser test: its Vite Node child exited with decimal 3221226505 (0xC0000409) before the helper received startup IPC. There was no application JavaScript stack or captured child output. This run remains a failed integration observation, not a session-validation pass.

Microsoft documents 0xC0000409 as a native fail-fast mechanism; the status name does not establish stack-buffer corruption, stack exhaustion or a resource cause. Sources: [fast-fail intrinsic](https://learn.microsoft.com/en-us/cpp/intrinsics/fastfail), [status interpretation](https://devblogs.microsoft.com/oldnewthing/20190108-00/?p=100655).

Independent read-only observation at 2026-09-08 03:12:50 KST recorded free physical memory 40,491,264 KB of 134,125,448 KB and free virtual memory 7,954,768 KB of 167,679,880 KB. Application events showed a PowerShell Win32Exception at 03:07:03; the last-hour node.exe 1000/1001 query returned no matching event. These facts do not prove the cause of the owned Vite child's failure. The browser helper reports the native failure and setup cleanup preserves the original error.

Root authorized one unchanged focused check after resource inspection; the previously failing case passed in 13.108 seconds. The same complete 25-test integration selection subsequently completed as handle `23328`: six suites/25 tests passed in 109.895 seconds, natural exit 0. No assertion was weakened and no forced exit or automatic retry was added. Preserve both outcomes; a repeated native failure requires investigation rather than cycling to obtain green. No unrelated process was killed.
