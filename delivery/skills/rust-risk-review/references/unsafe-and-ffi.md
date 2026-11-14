# Unsafe and FFI

## Panic and partial initialization

Trace the initialized range, allocation ownership and drop responsibility before and after every operation that can unwind. Include callbacks, indexing, allocation behavior and user-defined traits. Examine `set_len`, raw copies, moves and Drop paths for stale counts, duplicated ownership, uninitialized reads or a second destructor after partial failure.

Require a reachable panic and cleanup sequence before claiming unwind-induced memory corruption. A guard that updates the initialized prefix and owns exactly that prefix can make cleanup correct. Do not treat every unsafe block as suspect or assume all builds unwind. With abort semantics, report the remaining termination or availability impact separately; do not invent a returning unwinder.

Prefer established ownership guards or safe container operations when they preserve required behavior. Document the exact validity invariant. Proposed recovery must also handle a panic while cleaning up; merely adding a catch boundary does not repair invalid state.

## Foreign callbacks and resource lifetimes

Establish the ABI, supported toolchain, panic strategy and foreign API's callback contract. Trace registration, invocation threads, reentrancy, unregistration, outstanding callbacks and destruction. Borrowed captures or pointers must outlive every permitted call; unregistering a callback is sufficient only if the API guarantees that in-flight callbacks have finished. Check whether transferring the wrapper or freeing it violates thread affinity or ownership.

Keep unwinding behavior tied to the actual ABI and target. Do not assume a universal compiler version changed every foreign boundary. `catch_unwind` catches only unwinding panics, and `AssertUnwindSafe` asserts an invariant rather than proving it. If used, demonstrate that partially changed state remains valid, define the foreign-visible error result and ensure cleanup cannot leak a panic across a non-unwinding boundary. An abort may be the documented ABI behavior, but it can still be a reachable denial of service when untrusted input triggers it.

Exclude callbacks whose owned capture, lifetime and synchronization are enforced by the registration API. Missing foreign documentation leaves a specific contract gap; it does not justify inventing callback timing or declaring use-after-free proven.
