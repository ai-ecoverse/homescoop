// homescoop#1287 (slicc-kernel#1172): a global allocator for threaded Rust
// wasm (wasm32-wasip1-threads, wasm32-wasmer-wasi with threads) that
// refreshes this thread's view of the shared memory before it hands out a
// block above it.
//
// V8 checks a thread's bulk-memory memory.fill / memory.copy (memset, memcpy)
// against that thread's cached memory length, which can lag a memory.grow
// another thread's sbrk just did; the first memset into such a block then
// traps "memory access out of bounds" (plain stores work, no wrong bytes).
// memory.grow(0) on this thread refreshes the view. A block that ends above
// memory.size gets one before it is returned; realloc is alloc + refresh +
// copy + free, so the libc's own memcpy never meets a stale length. A block
// below the view (the common case) costs one memory.size. The same wrapper as
// wasi-pnpm's patches/0009.
//
// Use it from a binary crate's main.rs (a one-line patch), with the path in
// HOMESCOOP_WASM_ALLOC_RS at build time (build-common.sh's
// homescoop_rust_wasm_refresh_alloc exports it):
//
//   #[cfg(target_family = "wasm")]
//   include!(env!("HOMESCOOP_WASM_ALLOC_RS"));
//
// A crate that sets its own #[global_allocator] on wasm can't take this one;
// wrap that allocator the same way instead.

#[global_allocator]
static HOMESCOOP_WASM_REFRESH_ALLOC: HomescoopWasmRefreshAlloc = HomescoopWasmRefreshAlloc;

struct HomescoopWasmRefreshAlloc;

impl HomescoopWasmRefreshAlloc {
    #[inline]
    fn seen(ptr: *mut u8, size: usize) {
        use core::arch::wasm32::{memory_grow, memory_size};
        if !ptr.is_null() && (ptr as usize).saturating_add(size) > memory_size::<0>() * 65536 {
            memory_grow::<0>(0);
        }
    }
}

unsafe impl std::alloc::GlobalAlloc for HomescoopWasmRefreshAlloc {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        // SAFETY: forwarded to the system allocator with the same layout.
        let ptr = unsafe { std::alloc::System.alloc(layout) };
        Self::seen(ptr, layout.size());
        ptr
    }

    unsafe fn alloc_zeroed(&self, layout: std::alloc::Layout) -> *mut u8 {
        // calloc zeroes with memset inside libc: allocate, refresh, then zero.
        // SAFETY: as alloc; the block is layout.size() bytes when non-null.
        unsafe {
            let ptr = self.alloc(layout);
            if !ptr.is_null() {
                std::ptr::write_bytes(ptr, 0, layout.size());
            }
            ptr
        }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        // SAFETY: ptr came from System through this allocator with layout.
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, new_size: usize) -> *mut u8 {
        // SAFETY: the caller guarantees ptr/layout describe a live block and
        // new_size is valid for layout's alignment; the new block holds at
        // least min(old, new) bytes, copied before the old one is freed.
        unsafe {
            let new_layout = std::alloc::Layout::from_size_align_unchecked(new_size, layout.align());
            let new = self.alloc(new_layout);
            if !new.is_null() {
                std::ptr::copy_nonoverlapping(ptr, new, layout.size().min(new_size));
                self.dealloc(ptr, layout);
            }
            new
        }
    }
}
