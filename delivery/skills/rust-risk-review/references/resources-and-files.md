# Resources and files

## Resource exhaustion

Trace attacker-controlled lengths, counts, nesting, decompression, retries and fan-out to allocation or total work. Check arithmetic, buffering before validation, concurrent requests and retained state. A cap at one allocation is insufficient if the loop or aggregate can grow without bound. Conversely, a caller-enforced limit can invalidate a local-looking finding; verify its coverage rather than ignoring it.

State the attacker's control, realistic trigger and affected resource. A large constant, a Vec, or a fallible allocator is not itself a vulnerability. Bound total accepted work and concurrency at the owning interface, reject invalid requests before expensive processing, and preserve useful error behavior. A timeout needs an effective cancellation point; do not propose it as preemption for a non-yielding computation.

## Filesystem check/use races

Find a path-based check followed by opening, creating, replacing, removing or executing the checked name. Establish whether another actor can change that entry or any relevant ancestor between operations and whether the check makes a security decision. Identify the platform and actual open flags. Canonicalizing once does not freeze later pathname resolution.

Prefer operating through the same validated handle or a platform-supported directory-relative API with the required no-follow and containment semantics. Exclusive creation can prevent replacing an existing final name, but does not automatically protect writable ancestors or later opens. A lock coordinates only actors that obey it.

Exclude a race claim when exclusive access to the relevant directory tree is actually enforced for the full operation, or the operation does not rely on the prior check. An unexplained temporary path or permission bit alone does not establish that guarantee. Report missing attacker-access evidence explicitly rather than labeling every check/open pair exploitable.
