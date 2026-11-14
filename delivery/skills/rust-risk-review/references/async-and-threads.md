# Async and threads

## Cancellation at suspension points

Find futures dropped by selection, timeout, task abort or shutdown. Trace which state or external side effect has changed before each suspension, what Drop can restore synchronously, and what a caller retry observes. A lock released on cancellation does not restore an application item removed before the await. Look for lost work, duplicate writes, invalid queue state and cleanup that requires an await.

Exclude a finding when the operation is documented and enforced as cancellation-safe, ownership remains with a durable queue, or a completed transaction makes retry behavior explicit. A pending await is not itself a bug. Where the caller is missing, state the cancellation precondition rather than asserting every await is unsafe.

Move the cancellation boundary, retain recoverable ownership, or use an explicit commit protocol. Spawning a detached task is not a default fix: account for the task's owner, shutdown, errors, aborts and externally visible side effects. A timeout around synchronous CPU work cannot guarantee timely cancellation.

## Task transfer and auto traits

Read the actual spawn API and runtime. Standard spawn bounds often reject a non-Send or borrowed future at compile time; a missing written bound alone is not runtime unsoundness. A local task may legitimately hold non-Send values, and an owned Arc does not make its payload thread-safe. Trace any unsafe erasure or lifetime extension that bypasses the API's protections.

When presenting a cross-thread counterexample, bind the Rust edition and the values actually captured. [Rust 2021 disjoint capture](https://doc.rust-lang.org/edition-guide/rust-2021/disjoint-capture-in-closures.html) can capture a non-Send field instead of its Send wrapper, making that specific example fail to compile. Distinguish this rejected call from a safe caller that moves the whole wrapper into a consuming function. Do not label an uncompiled snippet as an executed or compiler-verified reproduction.

For manual `unsafe impl<T> Send` or `Sync`, inspect every field, generic bound and safe constructor. Send concerns transfer; Sync concerns shared access. A raw pointer to thread-affine foreign state can violate either promise even without a Rust method mutating through `&self`. Check destruction on the receiving thread, references returned to callers, interior mutability and aliases outside the wrapper.

An atomic or mutex is relevant only when it protects the actual resource and all access paths; it cannot by itself authorize moving a thread-affine handle. Conversely, a properly bounded wrapper with enforced exclusive ownership or synchronization is not a defect just because it contains unsafe code. A safety comment is a claim to verify. If an unsafe constructor delegates an invariant, verify that all later safe uses preserve that contract and the advertised Send/Sync capability.
